import { seedUniverse } from "./seed-universe";
import { ingestPriceSnapshots } from "./ingest-prices";
import { ingestDividends } from "./ingest-dividends";
import { ingestFinancials } from "./ingest-financials";
import { ingestMacro } from "./ingest-macro";
import { ingestNews } from "./ingest-news";
import { collectPerTicker } from "./failure-report";
import { allSeedSecurities } from "@/lib/data-sources/universes";
import { getPriceSource, type FallbackEvent } from "@/lib/data-sources/price-source";
import * as fred from "@/lib/data-sources/fred";
import * as newsRss from "@/lib/data-sources/news-rss";
import { getErrorMessage } from "@/lib/errors";

/**
 * Ingest/ops task runner — the single implementation behind BOTH the dev
 * endpoint (POST /api/dev/ingest) and the dashboard Ops panel's server
 * actions. Callers are responsible for authorization; nothing here checks
 * identity. Server-only (service-role paths).
 */

export const INGEST_TASKS = [
  "status",
  "seed-universe",
  "prices",
  "dividends",
  "fundamentals",
  "macro",
  "news",
  "run-dividend",
] as const;

export type IngestTaskName = (typeof INGEST_TASKS)[number];

export function isIngestTask(value: string): value is IngestTaskName {
  return (INGEST_TASKS as readonly string[]).includes(value);
}

/** Inclusive YYYY-MM-DD bounds for a trailing window ending today. */
function lookback(days: number): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

export async function runIngestTask(task: IngestTaskName): Promise<unknown> {
  switch (task) {
    case "seed-universe": {
      return seedUniverse();
    }
    case "prices": {
      const fallbacks: FallbackEvent[] = [];
      const source = await getPriceSource((e) => fallbacks.push(e));
      const { from, to } = lookback(365);
      const { rows, report } = await collectPerTicker(
        "prices",
        allSeedSecurities(),
        (s) => source.fetchPrices({ ticker: s.ticker, exchange: s.exchange, from, to }),
      );
      report.fallbacks = fallbacks;
      const ingest = await ingestPriceSnapshots(rows);
      return { pulled: rows.length, ...ingest, report };
    }
    case "dividends": {
      const fallbacks: FallbackEvent[] = [];
      const source = await getPriceSource((e) => fallbacks.push(e));
      const { from, to } = lookback(5 * 365);
      const { rows, report } = await collectPerTicker(
        "dividends",
        allSeedSecurities(),
        (s) => source.fetchDividends({ ticker: s.ticker, exchange: s.exchange, from, to }),
      );
      report.fallbacks = fallbacks;
      const ingest = await ingestDividends(rows);
      return { pulled: rows.length, ...ingest, report };
    }
    case "fundamentals": {
      const fallbacks: FallbackEvent[] = [];
      const source = await getPriceSource((e) => fallbacks.push(e));
      const { rows, report } = await collectPerTicker(
        "fundamentals",
        allSeedSecurities(),
        async (s) => {
          const snap = await source.fetchFundamentals({
            ticker: s.ticker,
            exchange: s.exchange,
          });
          return snap ? [snap] : [];
        },
      );
      report.fallbacks = fallbacks;
      const ingest = await ingestFinancials(rows);
      return { pulled: rows.length, ...ingest, report };
    }
    case "macro": {
      const { from, to } = lookback(365);
      const series = Object.entries(fred.SERIES).map(([label, seriesId]) => ({
        ticker: seriesId,
        exchange: "FRED",
        label,
        seriesId,
      }));
      const { rows, report } = await collectPerTicker("macro", series, (s) =>
        fred.fetchSeries({
          seriesId: s.seriesId,
          observationStart: from,
          observationEnd: to,
        }),
      );
      const ingest = await ingestMacro(rows);
      return { pulled: rows.length, ...ingest, report };
    }
    case "news": {
      const all = await newsRss.fetchAllFeeds();
      const ingest = await ingestNews(all);
      return { pulled: all.length, ...ingest };
    }
    case "run-dividend": {
      const [{ dividendAgent }, { runAgent }] = await Promise.all([
        import("@/lib/agents/dividend/agent"),
        import("@/lib/agents/run"),
      ]);
      return runAgent(
        dividendAgent,
        { reason: "manual ops trigger" },
        { trigger: "manual" },
      );
    }
    case "status": {
      const { listReadyAdapters, listStubbedAdapters, finnhub } = await import(
        "@/lib/data-sources"
      );
      const lseCoverage =
        finnhub.capabilities.readinessCheck() === null
          ? await finnhub.probeLseCoverage().catch((err: unknown) => ({
              covered: false as const,
              reason: getErrorMessage(err),
            }))
          : { covered: false as const, reason: "finnhub not configured" };
      return {
        ready: listReadyAdapters().map((a) => a.name),
        stubbed: listStubbedAdapters().map((x) => ({
          name: x.adapter.name,
          reason: x.reason,
        })),
        finnhubLseCoverage: lseCoverage,
      };
    }
  }
}
