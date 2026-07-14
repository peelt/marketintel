import { z } from "zod";
import { httpFetch } from "./http";
import { suffixSymbol } from "./symbols";
import {
  BlockedError,
  errorFromStatus,
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
 * Yahoo Finance adapter — FALLBACK source behind Finnhub (plan §3.5b).
 *
 * Unofficial. Uses query1/query2.finance.yahoo.com, which are undocumented
 * but stable enough for our refresh cadence. Expect periodic breakage; the
 * PriceSource abstraction exists so breakage degrades loudly (typed errors,
 * per-run failure report) rather than silently.
 *
 * The quoteSummary (fundamentals) endpoint has required cookie+crumb auth
 * since 2023 — a bare fetch 401s. getCrumb() below performs the same dance
 * the python yfinance library does: hit fc.yahoo.com for a session cookie,
 * exchange it for a crumb, then sign quoteSummary requests with both. The
 * pair is cached per process and refreshed once on a 401.
 */

const QUERY1 = "https://query1.finance.yahoo.com";
const QUERY2 = "https://query2.finance.yahoo.com";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const HOST_THROTTLE_MS = 300;

// ---------- response schemas ----------

const ChartZ = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({ currency: z.string().optional() }).passthrough(),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(
              z.object({
                open: z.array(z.number().nullable()).optional(),
                high: z.array(z.number().nullable()).optional(),
                low: z.array(z.number().nullable()).optional(),
                close: z.array(z.number().nullable()).optional(),
                volume: z.array(z.number().nullable()).optional(),
              }),
            ),
            adjclose: z
              .array(z.object({ adjclose: z.array(z.number().nullable()) }))
              .optional(),
          }),
          events: z
            .object({
              dividends: z
                .record(
                  z.string(),
                  z.object({ amount: z.number(), date: z.number() }),
                )
                .optional(),
            })
            .optional(),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string(), description: z.string() }).nullable(),
  }),
});

const QuoteSummaryZ = z.object({
  quoteSummary: z.object({
    result: z
      .array(
        z.object({
          summaryDetail: z
            .object({
              marketCap: z.object({ raw: z.number().optional() }).optional(),
              currency: z.string().optional(),
            })
            .passthrough()
            .optional(),
          defaultKeyStatistics: z
            .object({
              enterpriseValue: z.object({ raw: z.number().optional() }).optional(),
              sharesOutstanding: z.object({ raw: z.number().optional() }).optional(),
            })
            .passthrough()
            .optional(),
          financialData: z
            .object({
              totalCash: z.object({ raw: z.number().optional() }).optional(),
              totalDebt: z.object({ raw: z.number().optional() }).optional(),
              operatingCashflow: z.object({ raw: z.number().optional() }).optional(),
              freeCashflow: z.object({ raw: z.number().optional() }).optional(),
              ebitda: z.object({ raw: z.number().optional() }).optional(),
              totalRevenue: z.object({ raw: z.number().optional() }).optional(),
            })
            .passthrough()
            .optional(),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string(), description: z.string() }).nullable(),
  }),
});

// ---------- fetch + validate ----------

async function yahooJson<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
  extraHeaders?: Record<string, string>,
): Promise<z.infer<T>> {
  const res = await httpFetch(url, {
    userAgent: UA,
    hostThrottleMs: HOST_THROTTLE_MS,
    headers: extraHeaders,
  });
  if (!res.ok) throw errorFromStatus("yfinance", res.status, url);

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new SchemaChangedError("yfinance", `non-JSON response from ${url}`, {
      cause: err,
    });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SchemaChangedError(
      "yfinance",
      `${new URL(url).pathname} response no longer matches schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

// ---------- cookie + crumb (quoteSummary auth) ----------

let crumbCache: { cookie: string; crumb: string } | null = null;

async function getCrumb(
  forceRefresh = false,
): Promise<{ cookie: string; crumb: string }> {
  if (crumbCache && !forceRefresh) return crumbCache;

  // fc.yahoo.com 404s, but the response sets the session cookie we need.
  const seed = await httpFetch("https://fc.yahoo.com", {
    userAgent: UA,
    retries: 1,
  });
  const setCookie = seed.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0];
  if (!cookie) {
    throw new BlockedError("yfinance", "fc.yahoo.com returned no session cookie");
  }

  const crumbRes = await httpFetch(`${QUERY2}/v1/test/getcrumb`, {
    userAgent: UA,
    headers: { Cookie: cookie, Accept: "text/plain" },
  });
  if (!crumbRes.ok) {
    throw errorFromStatus("yfinance", crumbRes.status, "getcrumb");
  }
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<html")) {
    throw new BlockedError("yfinance", "getcrumb returned no usable crumb");
  }

  crumbCache = { cookie, crumb };
  return crumbCache;
}

export function clearCrumbCache(): void {
  crumbCache = null;
}

// ---------- chart (prices + dividends share one endpoint) ----------

type ChartResult = NonNullable<z.infer<typeof ChartZ>["chart"]["result"]>[number];

async function fetchChart(query: PriceRangeQuery, events: string): Promise<ChartResult> {
  const symbol = suffixSymbol(query.ticker, query.exchange);
  const qs = new URLSearchParams({
    period1: String(Math.floor(Date.parse(`${query.from}T00:00:00Z`) / 1000)),
    period2: String(Math.floor(Date.parse(`${query.to}T23:59:59Z`) / 1000)),
    interval: "1d",
    events,
    includeAdjustedClose: "true",
  });
  const url = `${QUERY1}/v8/finance/chart/${encodeURIComponent(symbol)}?${qs.toString()}`;
  const data = await yahooJson(url, ChartZ);

  if (data.chart.error) {
    const { code, description } = data.chart.error;
    if (code === "Not Found") {
      throw new NotFoundError("yfinance", `symbol ${symbol} unknown: ${description}`);
    }
    throw new SchemaChangedError(
      "yfinance",
      `chart error for ${symbol}: ${code} ${description}`,
    );
  }
  const result = data.chart.result?.[0];
  if (!result) {
    throw new NotFoundError("yfinance", `no chart result for ${symbol}`);
  }
  return result;
}

async function fetchPrices(query: PriceRangeQuery): Promise<RawPriceSnapshot[]> {
  const r = await fetchChart(query, "div,split");
  const quote = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const timestamps = r.timestamp ?? [];
  const currency = r.meta.currency; // "GBp" for LSE — pence, persisted verbatim
  const out: RawPriceSnapshot[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close?.[i];
    if (close == null) continue;
    out.push({
      ticker: query.ticker,
      exchange: query.exchange,
      snapshotDate: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      open: quote.open?.[i] ?? undefined,
      high: quote.high?.[i] ?? undefined,
      low: quote.low?.[i] ?? undefined,
      close,
      adjustedClose: adj?.[i] ?? undefined,
      volume: quote.volume?.[i] ?? undefined,
      currency,
      source: "yfinance",
    });
  }
  return out;
}

async function fetchDividends(query: PriceRangeQuery): Promise<RawDividend[]> {
  const r = await fetchChart(query, "div");
  const currency = r.meta.currency ?? "USD";
  const divs = r.events?.dividends ?? {};

  return Object.values(divs).map((d) => ({
    ticker: query.ticker,
    exchange: query.exchange,
    exDate: new Date(d.date * 1000).toISOString().slice(0, 10),
    amount: d.amount,
    currency,
    source: "yfinance" as const,
  }));
}

/**
 * Coarse TTM fundamentals via quoteSummary, authenticated with cookie+crumb.
 * On a 401 the cached pair is refreshed once and the request retried — Yahoo
 * session cookies expire and the first signal is an auth failure.
 */
async function fetchFundamentals(
  query: SymbolQuery,
): Promise<RawFinancialsSnapshot | null> {
  const symbol = suffixSymbol(query.ticker, query.exchange);
  const modules = ["summaryDetail", "defaultKeyStatistics", "financialData"].join(",");

  async function attempt(forceRefresh: boolean) {
    const { cookie, crumb } = await getCrumb(forceRefresh);
    const url = `${QUERY2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
    return yahooJson(url, QuoteSummaryZ, { Cookie: cookie });
  }

  let data: z.infer<typeof QuoteSummaryZ>;
  try {
    data = await attempt(false);
  } catch (err) {
    if (err instanceof BlockedError) {
      data = await attempt(true);
    } else {
      throw err;
    }
  }

  if (data.quoteSummary.error) {
    const { code, description } = data.quoteSummary.error;
    if (code === "Not Found") {
      throw new NotFoundError("yfinance", `symbol ${symbol} unknown: ${description}`);
    }
    throw new SchemaChangedError(
      "yfinance",
      `quoteSummary error for ${symbol}: ${code} ${description}`,
    );
  }

  const r = data.quoteSummary.result?.[0];
  if (!r) return null;

  const sd = r.summaryDetail;
  const ks = r.defaultKeyStatistics;
  const fd = r.financialData;

  return {
    ticker: query.ticker,
    exchange: query.exchange,
    periodEnd: new Date().toISOString().slice(0, 10),
    periodType: "ttm",
    revenue: fd?.totalRevenue?.raw,
    ebitda: fd?.ebitda?.raw,
    totalDebt: fd?.totalDebt?.raw,
    cashAndEquivalents: fd?.totalCash?.raw,
    operatingCashFlow: fd?.operatingCashflow?.raw,
    freeCashFlow: fd?.freeCashflow?.raw,
    marketCap: sd?.marketCap?.raw,
    enterpriseValue: ks?.enterpriseValue?.raw,
    sharesOutstanding: ks?.sharesOutstanding?.raw,
    source: "yfinance",
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
  };
}

export const yfinancePriceSource: PriceSource = {
  name: "yfinance",
  readiness: () => null, // no key required
  fetchPrices,
  fetchDividends,
  fetchFundamentals,
};

export const capabilities: AdapterCapabilities = {
  name: "yfinance",
  paid: false,
  readinessCheck: () => null,
  provides: ["prices", "dividends", "financials"],
};
