import type {
  DataSourceName,
  RawDividend,
  RawFinancialsSnapshot,
  RawPriceSnapshot,
} from "./types";
import { errorKind, isDataSourceError, NotConfiguredError } from "./errors";
import { getErrorMessage } from "@/lib/errors";

/**
 * Callable price/fundamentals source (plan §3.5b).
 *
 * Every provider that can serve prices implements this. Canonical date
 * bounds are `from`/`to` (YYYY-MM-DD, inclusive) — provider-specific range
 * strings ("1y", "5d") stay inside the adapter. Adapters throw the typed
 * errors in ./errors.ts; they never return silent zeros.
 *
 * Readiness is honest: implemented AND configured. A stubbed or key-less
 * adapter reports a reason string and is never selected as primary.
 */

export interface PriceRangeQuery {
  ticker: string;
  exchange: string;
  /** Inclusive start, YYYY-MM-DD. */
  from: string;
  /** Inclusive end, YYYY-MM-DD. */
  to: string;
}

export interface SymbolQuery {
  ticker: string;
  exchange: string;
}

export interface PriceSource {
  name: DataSourceName;
  /** null when ready to serve; otherwise the reason it can't. */
  readiness(): string | null;
  fetchPrices(query: PriceRangeQuery): Promise<RawPriceSnapshot[]>;
  fetchDividends(query: PriceRangeQuery): Promise<RawDividend[]>;
  fetchFundamentals(query: SymbolQuery): Promise<RawFinancialsSnapshot | null>;
}

export interface FallbackEvent {
  primary: DataSourceName;
  fallback: DataSourceName;
  method: "fetchPrices" | "fetchDividends" | "fetchFundamentals";
  ticker: string;
  exchange: string;
  kind: string;
  reason: string;
}

/**
 * Compose two sources into one: try `primary`, and on ANY failure fall back
 * to `fallback` — including `not_found`, since coverage differs by provider
 * (Finnhub may not know an LSE name that Yahoo serves fine). The primary's
 * failure is surfaced through `onFallback` so runs can report degraded
 * sourcing instead of silently absorbing it. If the fallback also fails, the
 * FALLBACK's error propagates (the primary's is already reported).
 */
export function withFallback(
  primary: PriceSource,
  fallback: PriceSource,
  onFallback?: (event: FallbackEvent) => void,
): PriceSource {
  async function attempt<T>(
    method: FallbackEvent["method"],
    query: SymbolQuery,
    call: (source: PriceSource) => Promise<T>,
  ): Promise<T> {
    try {
      return await call(primary);
    } catch (err) {
      onFallback?.({
        primary: primary.name,
        fallback: fallback.name,
        method,
        ticker: query.ticker,
        exchange: query.exchange,
        kind: errorKind(err),
        reason: getErrorMessage(err),
      });
      return call(fallback);
    }
  }

  return {
    name: primary.name,
    readiness: () => primary.readiness() ?? fallback.readiness(),
    fetchPrices: (q) => attempt("fetchPrices", q, (s) => s.fetchPrices(q)),
    fetchDividends: (q) => attempt("fetchDividends", q, (s) => s.fetchDividends(q)),
    fetchFundamentals: (q) =>
      attempt("fetchFundamentals", q, (s) => s.fetchFundamentals(q)),
  };
}

/**
 * Resolve the active price source: Finnhub primary with yfinance fallback
 * when FINNHUB_API_KEY is configured; yfinance alone otherwise. Imported
 * lazily so tests can compose sources directly without env plumbing.
 */
export async function getPriceSource(
  onFallback?: (event: FallbackEvent) => void,
): Promise<PriceSource> {
  const [{ finnhubPriceSource }, { yfinancePriceSource }] = await Promise.all([
    import("./finnhub"),
    import("./yfinance"),
  ]);
  if (finnhubPriceSource.readiness() === null) {
    return withFallback(finnhubPriceSource, yfinancePriceSource, onFallback);
  }
  return yfinancePriceSource;
}

/** Throw the adapter's own readiness reason as a typed error. */
export function assertReady(source: PriceSource): void {
  const reason = source.readiness();
  if (reason !== null) {
    throw new NotConfiguredError(source.name, reason);
  }
}

export { isDataSourceError };
