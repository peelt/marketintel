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
  "run-metals",
  "run-ipo",
  "run-geopolitical",
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

type SeedFeed = "prices" | "dividends" | "fundamentals";

// Serverless calls cap at maxDuration 300s; keep a margin for the DB writes
// that follow the fetch loop. If the estimated fetch time is under this, run
// inline (immediate counts + failure report); otherwise queue to Inngest.
const INLINE_BUDGET_MS = 210_000;

/**
 * Refresh a seed feed. On a fast plan (Twelve Data Grow, ~160ms/name) the whole
 * ~93-name universe fetches in seconds, so we run it inline and hand back real
 * counts and the per-ticker failure report — the fastest way to see whether
 * London names came back. On the free tier (~7.9s/name) the universe would blow
 * the serverless budget, so we queue the chunked Inngest job instead.
 */
// Fundamentals are DEFERRED by Twelve Data (plan-gated) and actually served by
// Finnhub, whose free-tier throttle sets the real pace — 2 calls per name
// (/stock/metric + /stock/profile2) at ~1.05s spacing, plus latency — no
// matter how fast the Twelve Data plan is. Estimating fundamentals at the
// Twelve Data pace made a 93-name run look like ~15s when it's really ~4min,
// which sailed past the serverless budget and hung the Ops panel.
const FUNDAMENTALS_PACE_MS = 2_800; // 2 Finnhub calls/name at 1.25s spacing + latency

async function refreshSeed(feed: SeedFeed, lookbackDays: number): Promise<unknown> {
  const { perRequestMs } = await import("@/lib/data-sources/twelvedata");
  const seeds = allSeedSecurities();
  const paceMs = feed === "fundamentals" ? FUNDAMENTALS_PACE_MS : perRequestMs();
  const estimateMs = seeds.length * paceMs;
  if (estimateMs <= INLINE_BUDGET_MS) {
    return fetchSeedInline(feed, lookbackDays);
  }
  return queueSeedRefresh(feed, lookbackDays);
}

/** Fetch a seed feed inline and persist it, returning counts + failure report. */
async function fetchSeedInline(feed: SeedFeed, lookbackDays: number): Promise<unknown> {
  const { getPriceSource } = await import("@/lib/data-sources/price-source");
  const fallbacks: import("@/lib/data-sources/price-source").FallbackEvent[] = [];
  const source = await getPriceSource((e) => fallbacks.push(e));
  const { from, to } = lookback(lookbackDays);
  const seeds = allSeedSecurities();

  if (feed === "prices") {
    const { ingestPriceSnapshots } = await import("./ingest-prices");
    const { rows, report } = await collectPerTicker("prices", seeds, (s) =>
      source.fetchPrices({ ticker: s.ticker, exchange: s.exchange, from, to }),
    );
    report.fallbacks = fallbacks;
    const ingest = await ingestPriceSnapshots(rows);
    return { pulled: rows.length, ...ingest, report };
  }
  if (feed === "dividends") {
    const { ingestDividends } = await import("./ingest-dividends");
    const { rows, report } = await collectPerTicker("dividends", seeds, (s) =>
      source.fetchDividends({ ticker: s.ticker, exchange: s.exchange, from, to }),
    );
    report.fallbacks = fallbacks;
    const ingest = await ingestDividends(rows);
    return { pulled: rows.length, ...ingest, report };
  }
  const { ingestFinancials } = await import("./ingest-financials");
  const { rows, report } = await collectPerTicker("fundamentals", seeds, async (s) => {
    const snap = await source.fetchFundamentals({ ticker: s.ticker, exchange: s.exchange });
    return snap ? [snap] : [];
  });
  report.fallbacks = fallbacks;
  const ingest = await ingestFinancials(rows);
  return { pulled: rows.length, ...ingest, report };
}

/**
 * Queue a seed refresh through the chunked Inngest job — used when the plan's
 * rate limit means the universe can't fetch inside one serverless call. Inngest
 * fans the work into per-chunk steps, each within the time budget, memoised on
 * resume. (No explicit ticker list → chunkedIngest defaults to the seed universe.)
 */
async function queueSeedRefresh(feed: SeedFeed, lookbackDays: number): Promise<unknown> {
  const { inngest } = await import("@/lib/inngest/client");
  const count = allSeedSecurities().length;
  await inngest.send({
    name: "ingest/refresh.requested",
    data: { feed, lookbackDays },
  });
  return {
    queued: count,
    feed,
    note: `${feed} refresh queued via Inngest (chunked) — the plan's rate limit makes it too slow to run inline. Progress appears in the Inngest dashboard.`,
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
      return refreshSeed("prices", 365);
    }
    case "dividends": {
      return refreshSeed("dividends", 5 * 365);
    }
    case "fundamentals": {
      return refreshSeed("fundamentals", 365);
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
    case "run-metals": {
      // ~23 names × deep-tier web research doesn't fit a server action's time
      // budget (the run takes 8–12 minutes) — hand it to the metals-weekly
      // Inngest function via its manual-trigger event instead of running
      // inline. Same code path and run-lifecycle guarantees as the cron.
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "agent/run.requested",
        data: { agentName: "metals", reason: "manual ops trigger" },
      });
      return {
        queued: 23,
        note: "Metals run queued via Inngest — it researches ~23 companies' cost reporting and takes 5–10 minutes. The report appears under Reports when it finishes (progress in the Inngest dashboard).",
      };
    }
    case "run-ipo": {
      // Discovery + one prospectus evaluation per fresh filing doesn't fit a
      // server action's time budget — hand it to the ipo-weekly Inngest
      // function via its manual-trigger event, same code path as the cron.
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "agent/run.requested",
        data: { agentName: "ipo", reason: "manual ops trigger" },
      });
      return {
        queued: 1,
        note: "IPO desk run queued via Inngest — it discovers the last 30 days of S-1/F-1 filings and evaluates each prospectus (5–10 minutes). The report appears under Reports when it finishes (progress in the Inngest dashboard).",
      };
    }
    case "run-geopolitical": {
      // One fresh macro web-research call + one grade per ~38 names doesn't fit
      // a server action's time budget — hand it to the geopolitical-weekly
      // Inngest function via its manual-trigger event, same code path as the
      // cron.
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "agent/run.requested",
        data: { agentName: "geopolitical", reason: "manual ops trigger" },
      });
      return {
        queued: 1,
        note: "Geopolitical run queued via Inngest — it researches the current backdrop and grades each name's positioning (5–10 minutes). The report appears under Reports when it finishes (progress in the Inngest dashboard).",
      };
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
