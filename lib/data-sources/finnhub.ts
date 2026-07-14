import { z } from "zod";
import { httpFetch } from "./http";
import { suffixSymbol } from "./symbols";
import {
  BlockedError,
  errorFromStatus,
  NotConfiguredError,
  NotFoundError,
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
 * Finnhub adapter — primary price/fundamentals source (settled decision,
 * plan §5, provisional pending the LSE readiness probe below).
 *
 * Free tier: ~60 calls/min, carries analyst data we may want later for the
 * eps_revision_trend reinstatement. Some endpoints (notably /stock/candle
 * for certain symbol classes) are paywalled per-plan — those come back 403,
 * which we surface as BlockedError so the fallback wrapper degrades to
 * yfinance instead of silently returning nothing.
 *
 * Every response is Zod-validated; drift throws SchemaChangedError.
 */

const BASE = "https://finnhub.io/api/v1";
// Free tier is 60 calls/min — space requests ≥1s apart to stay under it.
const HOST_THROTTLE_MS = 1_050;

function apiKey(): string | null {
  return process.env.FINNHUB_API_KEY || null;
}

// ---------- response schemas (validate what we consume, tolerate the rest) ----------

const CandleZ = z.union([
  z.object({ s: z.literal("no_data") }),
  z.object({
    s: z.literal("ok"),
    t: z.array(z.number()),
    o: z.array(z.number().nullable()),
    h: z.array(z.number().nullable()),
    l: z.array(z.number().nullable()),
    c: z.array(z.number().nullable()),
    v: z.array(z.number().nullable()),
  }),
]);

const DividendListZ = z.array(
  z
    .object({
      date: z.string(), // ex-date, YYYY-MM-DD
      amount: z.number(),
      payDate: z.string().nullish(),
      recordDate: z.string().nullish(),
      currency: z.string().nullish(),
    })
    .passthrough(),
);

const MetricZ = z
  .object({
    metric: z.record(z.string(), z.unknown()),
  })
  .passthrough();

/** Unknown symbols return an empty object — that's Finnhub's 404. */
const Profile2Z = z
  .object({
    currency: z.string().optional(),
    name: z.string().optional(),
    shareOutstanding: z.number().optional(),
  })
  .passthrough();

// ---------- fetch + validate ----------

async function finnhubJson<T extends z.ZodTypeAny>(
  path: string,
  params: Record<string, string>,
  schema: T,
): Promise<z.infer<T>> {
  const key = apiKey();
  if (!key) throw new NotConfiguredError("finnhub", "FINNHUB_API_KEY not set");

  const qs = new URLSearchParams(params);
  const url = `${BASE}${path}?${qs.toString()}`;
  const res = await httpFetch(url, {
    hostThrottleMs: HOST_THROTTLE_MS,
    headers: { "X-Finnhub-Token": key },
  });
  if (!res.ok) throw errorFromStatus("finnhub", res.status, `${path}?${qs}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new SchemaChangedError("finnhub", `non-JSON response from ${path}`, {
      cause: err,
    });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SchemaChangedError(
      "finnhub",
      `${path} response no longer matches schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

// ---------- profile cache (currency + shares outstanding per symbol) ----------

interface ProfileInfo {
  known: boolean;
  currency?: string;
  sharesOutstanding?: number;
}

const profileCache = new Map<string, ProfileInfo>();

async function profileFor(symbol: string): Promise<ProfileInfo> {
  const hit = profileCache.get(symbol);
  if (hit) return hit;

  const profile = await finnhubJson("/stock/profile2", { symbol }, Profile2Z);
  const known = Object.keys(profile).length > 0;
  const info: ProfileInfo = {
    known,
    currency: profile.currency,
    // Finnhub reports sharesOutstanding in millions.
    sharesOutstanding:
      profile.shareOutstanding != null
        ? profile.shareOutstanding * 1e6
        : undefined,
  };
  profileCache.set(symbol, info);
  return info;
}

export function clearProfileCache(): void {
  profileCache.clear();
}

// ---------- helpers ----------

function toUnixStart(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function toUnixEnd(date: string): number {
  return Math.floor(Date.parse(`${date}T23:59:59Z`) / 1000);
}

function isoDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------- PriceSource implementation ----------

async function fetchPrices(query: PriceRangeQuery): Promise<RawPriceSnapshot[]> {
  const symbol = suffixSymbol(query.ticker, query.exchange);
  const candle = await finnhubJson(
    "/stock/candle",
    {
      symbol,
      resolution: "D",
      from: String(toUnixStart(query.from)),
      to: String(toUnixEnd(query.to)),
    },
    CandleZ,
  );

  if (candle.s === "no_data") {
    // no_data is ambiguous: empty range vs unknown symbol. Disambiguate via
    // the (cached) profile so delistings surface as NotFound, not empties.
    const profile = await profileFor(symbol);
    if (!profile.known) {
      throw new NotFoundError("finnhub", `symbol ${symbol} unknown to provider`);
    }
    return [];
  }

  const profile = await profileFor(symbol).catch(() => null);
  const out: RawPriceSnapshot[] = [];
  for (let i = 0; i < candle.t.length; i++) {
    const close = candle.c[i];
    if (close == null) continue;
    out.push({
      ticker: query.ticker,
      exchange: query.exchange,
      snapshotDate: isoDay(candle.t[i]),
      open: candle.o[i] ?? undefined,
      high: candle.h[i] ?? undefined,
      low: candle.l[i] ?? undefined,
      close,
      volume: candle.v[i] ?? undefined,
      currency: profile?.currency,
      source: "finnhub",
    });
  }
  return out;
}

async function fetchDividends(query: PriceRangeQuery): Promise<RawDividend[]> {
  const symbol = suffixSymbol(query.ticker, query.exchange);
  const [dividends, profile] = await Promise.all([
    finnhubJson(
      "/stock/dividend",
      { symbol, from: query.from, to: query.to },
      DividendListZ,
    ),
    profileFor(symbol).catch(() => null),
  ]);

  return dividends.map((d) => ({
    ticker: query.ticker,
    exchange: query.exchange,
    exDate: d.date,
    recordDate: d.recordDate ?? undefined,
    payDate: d.payDate ?? undefined,
    amount: d.amount,
    currency: d.currency ?? profile?.currency ?? "USD",
    source: "finnhub" as const,
  }));
}

/**
 * TTM fundamentals snapshot from /stock/metric. Finnhub's basic-financials
 * payload is a wide bag of ratios; we map the absolute values we're sure of
 * and persist the full metric object in `raw` so agent resolvers (e.g. the
 * Dividend agent's payout/coverage signals) can read the ratios directly.
 */
async function fetchFundamentals(
  query: SymbolQuery,
): Promise<RawFinancialsSnapshot | null> {
  const symbol = suffixSymbol(query.ticker, query.exchange);
  const [{ metric }, profile] = await Promise.all([
    finnhubJson("/stock/metric", { symbol, metric: "all" }, MetricZ),
    profileFor(symbol).catch(() => null),
  ]);

  if (Object.keys(metric).length === 0) {
    if (profile && !profile.known) {
      throw new NotFoundError("finnhub", `symbol ${symbol} unknown to provider`);
    }
    return null;
  }

  // marketCapitalization is reported in millions of the listing currency.
  const marketCapMillions = finiteNumber(metric["marketCapitalization"]);
  const eps =
    finiteNumber(metric["epsTTM"]) ??
    finiteNumber(metric["epsExclExtraItemsTTM"]) ??
    finiteNumber(metric["epsInclExtraItemsTTM"]);

  return {
    ticker: query.ticker,
    exchange: query.exchange,
    periodEnd: new Date().toISOString().slice(0, 10),
    periodType: "ttm",
    epsDiluted: eps,
    marketCap: marketCapMillions != null ? marketCapMillions * 1e6 : undefined,
    sharesOutstanding: profile?.sharesOutstanding,
    source: "finnhub",
    sourceUrl: `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}`,
    raw: { metric, currency: profile?.currency },
  };
}

export const finnhubPriceSource: PriceSource = {
  name: "finnhub",
  readiness: () => (apiKey() ? null : "FINNHUB_API_KEY not set"),
  fetchPrices,
  fetchDividends,
  fetchFundamentals,
};

/**
 * LSE coverage probe (plan §5: confirm before locking Finnhub in as primary).
 * Async, so it can't live in readinessCheck(); the dev status endpoint calls
 * it on demand. Uses HSBA.L — a FTSE-100 name Finnhub must know if its LSE
 * coverage is real on our plan.
 */
export async function probeLseCoverage(): Promise<
  { covered: true } | { covered: false; reason: string }
> {
  try {
    const profile = await profileFor("HSBA.L");
    return profile.known
      ? { covered: true }
      : { covered: false, reason: "HSBA.L unknown to Finnhub on this plan" };
  } catch (err) {
    if (err instanceof BlockedError) {
      return { covered: false, reason: `LSE lookups blocked on this plan: ${err.message}` };
    }
    throw err;
  }
}

export const capabilities: AdapterCapabilities = {
  name: "finnhub",
  paid: false, // free tier; paid upgrade path exists on the same adapter
  readinessCheck: () => finnhubPriceSource.readiness(),
  provides: ["prices", "dividends", "financials"],
};
