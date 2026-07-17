import { inngest } from "../client";
import { metalsAgent } from "@/lib/agents/metals/agent";
import { runAgent } from "@/lib/agents/run";

/**
 * Scheduled Precious Metals run — Sat 12:00 UTC (registry schedule). Also
 * listens for manual `agent/run.requested` events scoped to this agent so a
 * dev/UI trigger flows through the same code path and gets the same
 * run-lifecycle guarantees.
 */
export const metalsScheduled = inngest.createFunction(
  { id: "metals-weekly", retries: 2 },
  [
    { cron: metalsAgent.meta.schedule },
    { event: "agent/run.requested", if: "event.data.agentName == 'metals'" },
  ],
  async ({ event }) => {
    const reason =
      event && "data" in event && event.data && typeof event.data === "object"
        ? (event.data as { reason?: string }).reason
        : undefined;
    const { reportId, runId } = await runAgent(
      metalsAgent,
      { reason },
      { trigger: reason ? "event" : "scheduled" },
    );
    return { reportId, runId };
  },
);
