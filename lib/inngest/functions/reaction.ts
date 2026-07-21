import { inngest } from "../client";
import { reactionAgent } from "@/lib/agents/reaction/agent";
import { runAgent, hasSucceededReportToday } from "@/lib/agents/run";
import { loadBroadUniverse } from "@/lib/agents/reaction/data";
import { allSeedSecurities } from "@/lib/data-sources/universes";

/**
 * Union of the broad market and the curated desk universes, deduped by
 * (ticker, exchange). Pure — exported for tests. The daily refresh covers
 * this whole set so every desk universe (metals royalties/juniors, the GLD
 * benchmark, geopolitical ADR/LSE names) and every holdable name gets fresh
 * prices — not just index constituents.
 */
export function dailyPriceUniverse(
  broad: { ticker: string; exchange: string }[],
): { ticker: string; exchange: string }[] {
  const byKey = new Map<string, { ticker: string; exchange: string }>();
  for (const s of broad) byKey.set(`${s.ticker}::${s.exchange}`, s);
  for (const s of allSeedSecurities()) {
    byKey.set(`${s.ticker}::${s.exchange}`, {
      ticker: s.ticker,
      exchange: s.exchange,
    });
  }
  return [...byKey.values()];
}

/**
 * Reaction Analyser — DAILY, post-close (a sharp drop is time-sensitive; the
 * overshoot it screens for mean-reverts in days, so a twice-weekly cadence
 * missed most of the window). Three triggers:
 *
 *   1. `ingest/refresh.completed` (feed == 'prices') — the primary, DATA-DRIVEN
 *      path: reaction runs the moment the evening price refresh lands, so it
 *      always screens on fresh closes whatever the data plan's speed.
 *   2. cron backstop (`meta.schedule`, weekdays ~post-close) — if the refresh
 *      ever fails to emit, the day still gets a run.
 *   3. `agent/run.requested` — the on-demand path (always runs).
 *
 * The scheduled/data-driven paths dedupe on a same-day report: whichever fires
 * first files today's edition, the other skips. concurrency:1 serialises them
 * so the second sees the first's report. On-demand is exempt (explicit).
 */
export const reactionScheduled = inngest.createFunction(
  { id: "reaction-daily", retries: 1, concurrency: { limit: 1 } },
  [
    { cron: reactionAgent.meta.schedule },
    { event: "ingest/refresh.completed", if: "event.data.feed == 'prices'" },
    { event: "agent/run.requested", if: "event.data.agentName == 'reaction'" },
  ],
  async ({ event, step }) => {
    const onDemand = event?.name === "agent/run.requested";
    const reason = onDemand
      ? (event.data as { reason?: string })?.reason
      : undefined;

    // Dedupe the two automatic paths (cron backstop + data-ready event) so only
    // the first firing of the day files. On-demand always runs.
    if (!onDemand) {
      const already = await step.run("reaction-ran-today", () =>
        hasSucceededReportToday(reactionAgent.meta.name),
      );
      if (already) return { skipped: "reaction already filed today" };
    }

    const { reportId, runId } = await runAgent(
      reactionAgent,
      { reason },
      { trigger: onDemand ? "event" : "scheduled" },
    );
    return { reportId, runId };
  },
);

/**
 * Daily price refresh — weekday evenings after the US close. Covers the broad
 * market PLUS every curated desk universe and the GLD benchmark (via
 * dailyPriceUniverse), so metals royalties/juniors, the gold benchmark, and
 * held desk names no longer go stale between rare manual Ops clicks. Emits the
 * chunked-ingest event (3.5c) with a short lookback, so each firing tops up
 * the last week rather than re-pulling a year.
 */
export const dailyPriceRefresh = inngest.createFunction(
  { id: "daily-broad-price-refresh", retries: 1 },
  { cron: "30 21 * * 1-5" }, // 21:30 UTC, after the 20:00/21:00 UTC US close
  async ({ step }) => {
    const universe = await step.run("load-price-universe", async () => {
      const broad = (await loadBroadUniverse()).map((r) => ({
        ticker: r.ticker,
        exchange: r.exchange,
      }));
      // Desk universes are seeded even before the broad market is, so the
      // refresh is useful (desk names + GLD) even when broad is empty.
      return dailyPriceUniverse(broad);
    });
    if (universe.length === 0) {
      return { skipped: "no securities seeded yet" };
    }
    await step.sendEvent("request-price-refresh", {
      name: "ingest/refresh.requested",
      data: { feed: "prices", lookbackDays: 7, tickers: universe },
    });
    return { requested: universe.length };
  },
);
