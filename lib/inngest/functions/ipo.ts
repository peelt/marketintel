import { inngest } from "../client";
import { ipoAgent } from "@/lib/agents/ipo/agent";
import { runAgent } from "@/lib/agents/run";

/**
 * Scheduled IPO desk run — Sun 18:00 UTC (registry schedule). Also listens
 * for manual `agent/run.requested` events scoped to this agent so a dev/UI
 * trigger flows through the same code path and gets the same run-lifecycle
 * guarantees.
 */
export const ipoScheduled = inngest.createFunction(
  { id: "ipo-weekly", retries: 2 },
  [
    { cron: ipoAgent.meta.schedule },
    { event: "agent/run.requested", if: "event.data.agentName == 'ipo'" },
  ],
  async ({ event }) => {
    const reason =
      event && "data" in event && event.data && typeof event.data === "object"
        ? (event.data as { reason?: string }).reason
        : undefined;
    const { reportId, runId } = await runAgent(
      ipoAgent,
      { reason },
      { trigger: reason ? "event" : "scheduled" },
    );
    return { reportId, runId };
  },
);
