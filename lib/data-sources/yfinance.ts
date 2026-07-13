import { httpJson } from "./http";
import type {
  AdapterCapabilities,
  RawDividend,
  RawFinancialsSnapshot,
  RawPriceSnapshot,
} from "./types";

/**
 * Yahoo Finance adapter.
 *
 * Unofficial. Uses query1.finance.yahoo.com / query2.finance.yahoo.com which
 * are undocumented but stable enough for our refresh cadence. Expect periodic
 * breakage; this is why the architecture supports paid adapter swap-in.
 *
 * Required headers: a real browser User-Agent. Yahoo blocks bare fetches.
 */

const QUERY1 = "https://query1.finance.yahoo.com";
const QUERY2 = "https://query2.finance.yahoo.com";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const HOST_THROTTLE_MS = 300;

// ---------- types from Yahoo (only what we use) ----------

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: { currency: string; symbol: string; exchangeName: string };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
        adjclose?: Array<{ adjclose: (number | null)[] }>;
      };
      events?: {
        dividends?: Record<string, { amount: number; date: number }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

interface YahooQuoteSummaryResponse {
  quoteSummary: {
    result: Array<{
      summaryDetail?: {
        dividendYield?: { raw?: number };
        payoutRatio?: { raw?: number };
        marketCap?: { raw?: number };
        currency?: string;
      };
      defaultKeyStatistics?: {
        enterpriseValue?: { raw?: number };
        sharesOutstanding?: { raw?: number };
      };
      financialData?: {
        totalCash?: { raw?: number };
        totalDebt?: { raw?: number };
        operatingCashflow?: { raw?: number };
        freeCashflow?: { raw?: number };
        ebitda?: { raw?: number };
        totalRevenue?: { raw?: number };
      };
    }>;
    error: { code: string; description: string } | null;
  };
}

// ---------- helpers ----------

function symbolFor(ticker: string, exchange: string): string {
  // Yahoo uses suffix conventions: .L for LSE, .TO for TSX, .HK for HKEX, etc.
  const upper = exchange.toUpperCase();
  if (upper === "LSE" || upper === "LON") return `${ticker}.L`;
  if (upper === "TSX") return `${ticker}.TO`;
  if (upper === "TSXV") return `${ticker}.V`;
  if (upper === "HKEX") return `${ticker}.HK`;
  if (upper === "ASX") return `${ticker}.AX`;
  return ticker; // US default
}

// ---------- public API ----------

export async function fetchPriceHistory(params: {
  ticker: string;
  exchange: string;
  /** Lookback period: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max. */
  range?: string;
  interval?: "1d" | "1wk" | "1mo";
}): Promise<RawPriceSnapshot[]> {
  const symbol = symbolFor(params.ticker, params.exchange);
  const qs = new URLSearchParams({
    range: params.range ?? "1y",
    interval: params.interval ?? "1d",
    events: "div,split",
    includeAdjustedClose: "true",
  });
  const url = `${QUERY1}/v8/finance/chart/${encodeURIComponent(symbol)}?${qs.toString()}`;
  const data = await httpJson<YahooChartResponse>(url, {
    userAgent: UA,
    hostThrottleMs: HOST_THROTTLE_MS,
  });

  if (data.chart.error || !data.chart.result?.[0]) {
    throw new Error(
      `yfinance chart failed for ${symbol}: ${data.chart.error?.description ?? "no result"}`,
    );
  }

  const r = data.chart.result[0];
  const quote = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const out: RawPriceSnapshot[] = [];

  for (let i = 0; i < r.timestamp.length; i++) {
    const close = quote.close[i];
    if (close == null) continue;
    out.push({
      ticker: params.ticker,
      exchange: params.exchange,
      snapshotDate: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
      open: quote.open[i] ?? undefined,
      high: quote.high[i] ?? undefined,
      low: quote.low[i] ?? undefined,
      close,
      adjustedClose: adj?.[i] ?? undefined,
      volume: quote.volume[i] ?? undefined,
      source: "yfinance",
    });
  }
  return out;
}

export async function fetchDividendHistory(params: {
  ticker: string;
  exchange: string;
  /** Looking back further than 5y is rarely useful for cut-prediction signals. */
  range?: string;
}): Promise<RawDividend[]> {
  const symbol = symbolFor(params.ticker, params.exchange);
  const qs = new URLSearchParams({
    range: params.range ?? "5y",
    interval: "1mo",
    events: "div",
  });
  const url = `${QUERY1}/v8/finance/chart/${encodeURIComponent(symbol)}?${qs.toString()}`;
  const data = await httpJson<YahooChartResponse>(url, {
    userAgent: UA,
    hostThrottleMs: HOST_THROTTLE_MS,
  });

  const r = data.chart.result?.[0];
  if (!r) return [];
  const currency = r.meta.currency;
  const divs = r.events?.dividends ?? {};

  return Object.values(divs).map((d) => ({
    ticker: params.ticker,
    exchange: params.exchange,
    exDate: new Date(d.date * 1000).toISOString().slice(0, 10),
    amount: d.amount,
    currency,
    source: "yfinance",
  }));
}

/**
 * Fetch a coarse fundamentals snapshot. Yahoo's quoteSummary endpoint returns
 * a melange of valuation and balance-sheet metrics at the current moment.
 * Treated as TTM. Use FMP (when paid) for clean historical quarterly series.
 */
export async function fetchFundamentalsSnapshot(params: {
  ticker: string;
  exchange: string;
}): Promise<RawFinancialsSnapshot | null> {
  const symbol = symbolFor(params.ticker, params.exchange);
  const modules = [
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
  ].join(",");
  const url = `${QUERY2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
  const data = await httpJson<YahooQuoteSummaryResponse>(url, {
    userAgent: UA,
    hostThrottleMs: HOST_THROTTLE_MS,
  });

  const r = data.quoteSummary.result?.[0];
  if (!r) return null;

  const sd = r.summaryDetail ?? {};
  const ks = r.defaultKeyStatistics ?? {};
  const fd = r.financialData ?? {};

  return {
    ticker: params.ticker,
    exchange: params.exchange,
    periodEnd: new Date().toISOString().slice(0, 10),
    periodType: "ttm",
    revenue: fd.totalRevenue?.raw,
    ebitda: fd.ebitda?.raw,
    totalDebt: fd.totalDebt?.raw,
    cashAndEquivalents: fd.totalCash?.raw,
    operatingCashFlow: fd.operatingCashflow?.raw,
    freeCashFlow: fd.freeCashflow?.raw,
    marketCap: sd.marketCap?.raw,
    enterpriseValue: ks.enterpriseValue?.raw,
    sharesOutstanding: ks.sharesOutstanding?.raw,
    source: "yfinance",
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
  };
}

export const capabilities: AdapterCapabilities = {
  name: "yfinance",
  paid: false,
  readinessCheck: () => null, // No key required.
  provides: ["prices", "dividends", "financials"],
};
