import { seedUniverse } from "./seed-universe";
import { ingestMacro } from "./ingest-macro";
import { ingestNews } from "./ingest-news";
import { collectPerTicker } from "./failure-report";
import { allSeedSecurities } from "@/lib/data-sources/universes";
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
  "seed-broad-universe",
  "prices",
  "dividends",
  "fundamentals",
  "macro",
  "news",
  "run-dividend",
  "run-reaction",
  "broad-prices",
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

/**
 * Queue a seed-universe refresh through the chunked Inngest job rather than
 * running it inline. At the primary provider's free-tier rate cap (Twelve Data:
 * 8 credits/min) the full seed universe can't complete inside one serverless
 * call — each name is spaced seconds apart. Inngest fans the work into
 * per-chunk steps, each within the time budget, and memoises them on resume.
 * (No explicit ticker list → chunkedIngest defaults to the seed universe.)
 */
async function queueSeedRefresh(
  feed: "prices" | "dividends" | "fundamentals",
  lookbackDays: number,
): Promise<unknown> {
  const { inngest } = await import("@/lib/inngest/client");
  const count = allSeedSecurities().length;
  await inngest.send({
    name: "ingest/refresh.requested",
    data: { feed, lookbackDays },
  });
  return {
    queued: count,
    feed,
    note: `${feed} refresh queued via Inngest (chunked). Progress appears in the Inngest dashboard; at free-tier rate limits the full run takes a few minutes.`,
  };
}

export async function runIngestTask(task: IngestTaskName): Promise<unknown> {
  switch (task) {
    case "seed-universe": {
      return seedUniverse();
    }
    case "seed-broad-universe": {
      const { seedBroadUniverse } = await import("./seed-broad-universe");
      return seedBroadUniverse();
    }
    case "prices": {
      return queueSeedRefresh("prices", 365);
    }
    case "dividends": {
      return queueSeedRefresh("dividends", 5 * 365);
    }
    case "fundamentals": {
      return queueSeedRefresh("fundamentals", 365);
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
    case "run-reaction": {
      const [{ reactionAgent }, { runAgent }] = await Promise.all([
        import("@/lib/agents/reaction/agent"),
        import("@/lib/agents/run"),
      ]);
      return runAgent(
        reactionAgent,
        { reason: "manual ops trigger" },
        { trigger: "manual" },
      );
    }
    case "broad-prices": {
      // ~850 names at provider throttle far exceeds one serverless call —
      // hand the work to the chunked Inngest job (3.5c). Requires Inngest to
      // be connected; the returned note says so if it isn't.
      const [{ loadBroadUniverse }, { inngest }] = await Promise.all([
        import("@/lib/agents/reaction/data"),
        import("@/lib/inngest/client"),
      ]);
      const universe = await loadBroadUniverse();
      if (universe.length === 0) {
        throw new Error(
          "broad universe is empty — run seed-broad-universe first",
        );
      }
      await inngest.send({
        name: "ingest/refresh.requested",
        data: {
          feed: "prices",
          lookbackDays: 400,
          tickers: universe.map((u) => ({ ticker: u.ticker, exchange: u.exchange })),
        },
      });
      return {
        queued: universe.length,
        note: "Price fetch queued via Inngest (chunked). Progress appears in the Inngest dashboard; the run takes a while at free-tier rate limits.",
      };
    }
    case "status": {
      const { listReadyAdapters, listStubbedAdapters, finnhub, twelvedata } =
        await import("@/lib/data-sources");
      const lseCoverage =
        finnhub.capabilities.readinessCheck() === null
          ? await finnhub.probeLseCoverage().catch((err: unknown) => ({
              covered: false as const,
              reason: getErrorMessage(err),
            }))
          : { covered: false as const, reason: "finnhub not configured" };
      // The active price primary is the first configured link in the chain
      // (Twelve Data → Finnhub → yfinance); yfinance is always available but
      // blocks datacenter IPs, so it's the floor, not a real primary.
      const pricePrimary =
        twelvedata.capabilities.readinessCheck() === null
          ? "twelvedata"
          : finnhub.capabilities.readinessCheck() === null
            ? "finnhub"
            : "yfinance (fallback only — blocks datacenter IPs)";
      return {
        pricePrimary,
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
