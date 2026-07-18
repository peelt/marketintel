import { inngest } from "../client";
import { reactionAgent } from "@/lib/agents/reaction/agent";
import { runAgent } from "@/lib/agents/run";
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
 * Reaction Analyser schedule — Tue + Fri 17:00 UTC (settled, plan §5), plus
 * the manual agent/run.requested path. Runs through runAgent's hardened
 * lifecycle (failed runs always leave an auditable row).
 */
export const reactionScheduled = inngest.createFunction(
  { id: "reaction-twice-weekly", retries: 1 },
  [
    { cron: reactionAgent.meta.schedule },
    { event: "agent/run.requested", if: "event.data.agentName == 'reaction'" },
  ],
  async ({ event }) => {
    const reason =
      event && "data" in event && event.data && typeof event.data === "object"
        ? (event.data as { reason?: string }).reason
        : undefined;
    const { reportId, runId } = await runAgent(
      reactionAgent,
      { reason },
      { trigger: reason ? "event" : "scheduled" },
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
