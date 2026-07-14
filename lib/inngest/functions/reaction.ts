import { inngest } from "../client";
import { reactionAgent } from "@/lib/agents/reaction/agent";
import { runAgent } from "@/lib/agents/run";
import { loadBroadUniverse } from "@/lib/agents/reaction/data";

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
 * Daily price refresh for the broad-market universe — weekday evenings after
 * the US close. Emits the chunked-ingest event (3.5c) with a short lookback,
 * so each firing tops up the last week rather than re-pulling a year. The
 * Reaction screen is only as fresh as this job.
 */
export const dailyPriceRefresh = inngest.createFunction(
  { id: "daily-broad-price-refresh", retries: 1 },
  { cron: "30 21 * * 1-5" }, // 21:30 UTC, after the 20:00/21:00 UTC US close
  async ({ step }) => {
    const universe = await step.run("load-broad-universe", async () => {
      const rows = await loadBroadUniverse();
      return rows.map((r) => ({ ticker: r.ticker, exchange: r.exchange }));
    });
    if (universe.length === 0) {
      return { skipped: "broad universe not seeded yet" };
    }
    await step.sendEvent("request-price-refresh", {
      name: "ingest/refresh.requested",
      data: { feed: "prices", lookbackDays: 7, tickers: universe },
    });
    return { requested: universe.length };
  },
);
