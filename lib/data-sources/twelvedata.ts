import { z } from "zod";
import { httpFetch } from "./http";
import {
  BlockedError,
  DataSourceError,
  errorFromStatus,
  NotConfiguredError,
  NotFoundError,
  RateLimitedError,
  SchemaChangedError,
} from "./errors";
import type { PriceSource, PriceRangeQuery, SymbolQuery } from "./price-source";
import type {
  AdapterCapabilities,
  RawDividend,
  RawFinancialsSnapshot,
  RawPriceSnapshot,
} from "./types";

/**
 * Twelve Data adapter — primary price source (supersedes Finnhub, plan §5).
 *
 * Why the switch: Finnhub's free tier paywalls /stock/candle for EVERY symbol
 * class (US and LSE alike), so it can serve no price history at all; the
 * scraped fallbacks (Yahoo, Stooq) block datacenter IPs (429 / JS proof-of-work
 * wall) and so are dead from Vercel. Twelve Data is a keyed REST API built for
 * server access — it returns clean JSON from datacenter ranges and covers both
 * US and LSE on the free tier.
 *
 * Free tier is 8 API credits/min and 800/day. /time_series is 1 credit, so a
 * 25-name chunk (HOST_THROTTLE_MS below) fits inside one serverless call; the
 * full universe is refreshed via the chunked Inngest job, never inline.
 *
 * Dividends ride the /dividends endpoint (best-effort — 401/403 there degrades
 * to the fallback provider). Fundamentals are NOT served here: the free tier
 * paywalls them, so fetchFundamentals throws to defer to Finnhub/yfinance.
 *
 * Every response is Zod-validated; drift throws SchemaChangedError.
 */

const BASE = "https://api.twelvedata.com";
// Free tier is 8 credits/min — space requests ≥7.6s apart to stay under it.
// Disabled under test (fetch is stubbed; the throttle would blow the timeout).
const HOST_THROTTLE_MS = process.env.VITEST ? 0 : 7_600;

function apiKey(): string | null {
  return process.env.TWELVEDATA_API_KEY || null;
}

/**
 * Twelve Data addresses non-US listings by (symbol, exchange) rather than a
 * suffix. Trailing dots (Aviva "AV.") are stripped — they're a UK ticker
 * quirk, not part of the provider symbol. US names are bare with no exchange.
 */
export function tdSymbol(
  ticker: string,
  exchange: string,
): { symbol: string; exchange?: string } {
  const symbol = ticker.replace(/\.+$/, "");
  const upper = exchange.toUpperCase();
  if (upper === "LSE" || upper === "LON") return { symbol, exchange: "LSE" };
  if (upper === "TSX") return { symbol, exchange: "TSX" };
  if (upper === "TSXV") return { symbol, exchange: "TSXV" };
  if (upper === "HKEX") return { symbol, exchange: "HKEX" };
  if (upper === "ASX") return { symbol, exchange: "ASX" };
  return { symbol: ticker }; // US default — bare, no exchange
}

// ---------- response schemas (validate what we consume, tolerate the rest) ----------

/**
 * Every Twelve Data endpoint returns EITHER a success body OR
 * `{ status: "error", code, message }`. A 200 with an error body is common
 * (bad symbol, out-of-plan endpoint), so we branch on `status` before shape.
 */
const ErrorZ = z.object({
  status: z.literal("error"),
  code: z.number(),
  message: z.string(),
});

const TimeSeriesZ = z.object({
  meta: z
    .object({
      symbol: z.string().optional(),
      currency: z.string().optional(),
      exchange: z.string().optional(),
    })
    .passthrough(),
  values: z
    .array(
      z.object({
        datetime: z.string(), // YYYY-MM-DD for interval=1day
        open: z.string().nullish(),
        high: z.string().nullish(),
        low: z.string().nullish(),
        close: z.string(),
        volume: z.string().nullish(),
      }),
    )
    .nullish(),
  status: z.literal("ok").optional(),
});

const DividendsZ = z.object({
  meta: z
    .object({ currency: z.string().optional() })
    .passthrough()
    .optional(),
  dividends: z
    .array(
      z.object({
        ex_date: z.string(), // YYYY-MM-DD
        amount: z.number(),
      }),
    )
    .nullish(),
});

// ---------- fetch + validate ----------

function buildUrl(path: string, params: Record<string, string | undefined>): string {
  const key = apiKey();
  if (!key) {
    throw new NotConfiguredError("twelvedata", "TWELVEDATA_API_KEY not set");
  }
  const qs = new URLSearchParams({ apikey: key });
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, v);
  }
  return `${BASE}${path}?${qs.toString()}`;
}

async function tdJson<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
): Promise<z.infer<T>> {
  const res = await httpFetch(url, { hostThrottleMs: HOST_THROTTLE_MS });
  if (!res.ok) throw errorFromStatus("twelvedata", res.status, redact(url));

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new SchemaChangedError("twelvedata", `non-JSON response from ${redact(url)}`, {
      cause: err,
    });
  }

  // Error envelope can arrive with a 200 — map its code onto the taxonomy.
  const asError = ErrorZ.safeParse(body);
  if (asError.success) {
    throw errorFromCode(asError.data.code, asError.data.message);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SchemaChangedError(
      "twelvedata",
      `${new URL(url).pathname} response no longer matches schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

/** Keep the API key out of error messages and logs. */
function redact(url: string): string {
  return url.replace(/apikey=[^&]+/, "apikey=***");
}

/** Twelve Data's own error codes map onto our taxonomy. */
function errorFromCode(code: number, message: string): DataSourceError {
  if (code === 404) return new NotFoundError("twelvedata", message);
  if (code === 429) return new RateLimitedError("twelvedata", message);
  if (code === 401 || code === 403) return new BlockedError("twelvedata", message);
  // 400 = bad symbol/params → treat as not_found so a fallback provider can try.
  if (code === 400) return new NotFoundError("twelvedata", message);
  return new DataSourceError("network", "twelvedata", `code ${code}: ${message}`);
}

// ---------- prices ----------

async function fetchPrices(query: PriceRangeQuery): Promise<RawPriceSnapshot[]> {
  const { symbol, exchange } = tdSymbol(query.ticker, query.exchange);
  const url = buildUrl("/time_series", {
    symbol,
    exchange,
    interval: "1day",
    start_date: query.from,
    end_date: query.to,
    order: "ASC",
    outputsize: "5000",
  });
  const data = await tdJson(url, TimeSeriesZ);
  const currency = data.meta.currency; // "GBp"/"GBX" for LSE — persisted verbatim
  const out: RawPriceSnapshot[] = [];

  for (const v of data.values ?? []) {
    const close = num(v.close);
    if (close == null) continue;
    out.push({
      ticker: query.ticker,
      exchange: query.exchange,
      snapshotDate: v.datetime.slice(0, 10),
      open: num(v.open),
      high: num(v.high),
      low: num(v.low),
      close,
      volume: num(v.volume),
      currency,
      source: "twelvedata",
    });
  }
  return out;
}

// ---------- dividends (best-effort; paywalled on some plans) ----------

async function fetchDividends(query: PriceRangeQuery): Promise<RawDividend[]> {
  const { symbol, exchange } = tdSymbol(query.ticker, query.exchange);
  const url = buildUrl("/dividends", {
    symbol,
    exchange,
    start_date: query.from,
    end_date: query.to,
  });
  const data = await tdJson(url, DividendsZ);
  const currency = data.meta?.currency ?? "USD";

  return (data.dividends ?? []).map((d) => ({
    ticker: query.ticker,
    exchange: query.exchange,
    exDate: d.ex_date.slice(0, 10),
    amount: d.amount,
    currency,
    source: "twelvedata" as const,
  }));
}

// ---------- fundamentals (deferred) ----------

/**
 * The free tier paywalls fundamentals (/statistics, /income_statement…), so
 * this throws to hand fundamentals to the next provider in the chain (Finnhub
 * /stock/metric, then yfinance). Throwing — not returning null — is what
 * triggers the fallback wrapper; a null would be read as "no data" and stop.
 */
async function fetchFundamentals(
  _query: SymbolQuery,
): Promise<RawFinancialsSnapshot | null> {
  throw new NotFoundError(
    "twelvedata",
    "fundamentals are paywalled on the free tier — deferring to fallback provider",
  );
}

function num(v: string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const twelvedataPriceSource: PriceSource = {
  name: "twelvedata",
  readiness: () => (apiKey() ? null : "TWELVEDATA_API_KEY not set"),
  fetchPrices,
  fetchDividends,
  fetchFundamentals,
};

export const capabilities: AdapterCapabilities = {
  name: "twelvedata",
  paid: false, // free tier: 8 credits/min, 800/day
  readinessCheck: () => twelvedataPriceSource.readiness(),
  provides: ["prices", "dividends"],
};
