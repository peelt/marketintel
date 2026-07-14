import { errorKind } from "@/lib/data-sources/errors";
import type { FallbackEvent } from "@/lib/data-sources/price-source";
import { getErrorMessage } from "@/lib/errors";

/**
 * Per-run ingest failure report (plan §3.5b).
 *
 * Replaces the silent per-ticker `catch {}` pattern: every skipped name is
 * recorded with its typed error kind so a run's output says WHICH tickers
 * failed and WHY — a delisted name (not_found) reads differently from a
 * provider schema change (schema_changed) or a throttle (rate_limited).
 */

export interface IngestFailure {
  feed: string;
  ticker?: string;
  exchange?: string;
  /** DataSourceErrorKind, or "unknown" for untyped throws. */
  kind: string;
  reason: string;
}

export interface IngestRunReport {
  feed: string;
  attempted: number;
  succeeded: number;
  failed: number;
  failures: IngestFailure[];
  /** Primary-source failures that were absorbed by the fallback adapter. */
  fallbacks: FallbackEvent[];
}

export function createRunReport(feed: string): IngestRunReport {
  return {
    feed,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    failures: [],
    fallbacks: [],
  };
}

/**
 * Run `fn` once per seed, collecting results and recording failures instead
 * of swallowing them. The run always completes — one bad ticker never aborts
 * the batch — but nothing fails silently anymore.
 */
export async function collectPerTicker<S extends { ticker: string; exchange: string }, R>(
  feed: string,
  seeds: S[],
  fn: (seed: S) => Promise<R[]>,
): Promise<{ rows: R[]; report: IngestRunReport }> {
  const report = createRunReport(feed);
  const rows: R[] = [];

  for (const seed of seeds) {
    report.attempted++;
    try {
      rows.push(...(await fn(seed)));
      report.succeeded++;
    } catch (err) {
      report.failed++;
      report.failures.push({
        feed,
        ticker: seed.ticker,
        exchange: seed.exchange,
        kind: errorKind(err),
        reason: getErrorMessage(err),
      });
    }
  }

  return { rows, report };
}
