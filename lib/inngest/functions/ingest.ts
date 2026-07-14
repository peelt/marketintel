import { inngest } from "../client";
import { chunk } from "@/lib/concurrency";
import { allSeedSecurities } from "@/lib/data-sources/universes";
import { getPriceSource, type FallbackEvent } from "@/lib/data-sources/price-source";
import { collectPerTicker, type IngestRunReport } from "@/lib/ingest/failure-report";
import { ingestPriceSnapshots } from "@/lib/ingest/ingest-prices";
import { ingestDividends } from "@/lib/ingest/ingest-dividends";
import { ingestFinancials } from "@/lib/ingest/ingest-financials";

/**
 * Chunked ingest (plan §3.5c): a single route handler fanning out to 800
 * tickers times out; here each chunk is its own Inngest step — separately
 * retried, memoised on resume, and individually inside the serverless time
 * budget. 800 names / CHUNK_SIZE(25) = 32 steps, well within limits.
 *
 * Trigger: `ingest/refresh.requested` with a feed (prices | dividends |
 * fundamentals), optional lookback and optional explicit ticker list (PR 5's
 * broad-market universe passes its own list; default is the seed universe).
 *
 * The per-run failure report survives chunking: chunk reports are merged so
 * the function's return value still says exactly which names failed and why.
 */

const CHUNK_SIZE = 25;

type Feed = "prices" | "dividends" | "fundamentals";

interface ChunkOutcome {
  pulled: number;
  inserted: number;
  skipped: number;
  report: IngestRunReport;
}

function lookbackRange(days: number): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

async function ingestChunk(
  feed: Feed,
  seeds: { ticker: string; exchange: string }[],
  lookbackDays: number,
): Promise<ChunkOutcome> {
  const fallbacks: FallbackEvent[] = [];
  const source = await getPriceSource((e) => fallbacks.push(e));
  const { from, to } = lookbackRange(lookbackDays);

  if (feed === "prices") {
    const { rows, report } = await collectPerTicker("prices", seeds, (s) =>
      source.fetchPrices({ ticker: s.ticker, exchange: s.exchange, from, to }),
    );
    report.fallbacks = fallbacks;
    const outcome = await ingestPriceSnapshots(rows);
    return { pulled: rows.length, ...outcome, report };
  }
  if (feed === "dividends") {
    const { rows, report } = await collectPerTicker("dividends", seeds, (s) =>
      source.fetchDividends({ ticker: s.ticker, exchange: s.exchange, from, to }),
    );
    report.fallbacks = fallbacks;
    const outcome = await ingestDividends(rows);
    return { pulled: rows.length, ...outcome, report };
  }
  const { rows, report } = await collectPerTicker("fundamentals", seeds, async (s) => {
    const snap = await source.fetchFundamentals({
      ticker: s.ticker,
      exchange: s.exchange,
    });
    return snap ? [snap] : [];
  });
  report.fallbacks = fallbacks;
  const outcome = await ingestFinancials(rows);
  return { pulled: rows.length, ...outcome, report };
}

function mergeOutcomes(feed: Feed, outcomes: ChunkOutcome[]): ChunkOutcome {
  const merged: ChunkOutcome = {
    pulled: 0,
    inserted: 0,
    skipped: 0,
    report: {
      feed,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      failures: [],
      fallbacks: [],
    },
  };
  for (const o of outcomes) {
    merged.pulled += o.pulled;
    merged.inserted += o.inserted;
    merged.skipped += o.skipped;
    merged.report.attempted += o.report.attempted;
    merged.report.succeeded += o.report.succeeded;
    merged.report.failed += o.report.failed;
    merged.report.failures.push(...o.report.failures);
    merged.report.fallbacks.push(...o.report.fallbacks);
  }
  return merged;
}

export const chunkedIngest = inngest.createFunction(
  { id: "chunked-ingest", retries: 1 },
  { event: "ingest/refresh.requested" },
  async ({ event, step }) => {
    const feed = event.data.feed as Feed;
    const lookbackDays =
      event.data.lookbackDays ?? (feed === "dividends" ? 5 * 365 : 365);

    const seeds: { ticker: string; exchange: string }[] =
      event.data.tickers ??
      allSeedSecurities().map((s) => ({ ticker: s.ticker, exchange: s.exchange }));

    const chunks = chunk(seeds, CHUNK_SIZE);
    const outcomes: ChunkOutcome[] = [];
    for (let i = 0; i < chunks.length; i++) {
      outcomes.push(
        await step.run(`ingest-${feed}-chunk-${i + 1}-of-${chunks.length}`, () =>
          ingestChunk(feed, chunks[i], lookbackDays),
        ),
      );
    }

    return mergeOutcomes(feed, outcomes);
  },
);
