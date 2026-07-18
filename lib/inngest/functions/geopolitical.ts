import { inngest } from "../client";
import { geopoliticalAgent } from "@/lib/agents/geopolitical/agent";
import { runAgent } from "@/lib/agents/run";

/**
 * Scheduled Geopolitical run — Sun 20:00 UTC (registry schedule). Also
 * listens for manual `agent/run.requested` events scoped to this agent so a
 * dev/UI trigger flows through the same code path and gets the same
 * run-lifecycle guarantees.
 */
export const geopoliticalScheduled = inngest.createFunction(
  // concurrency 1: singleton agent with mutable run-context — serialise
  // overlapping manual + cron triggers.
  { id: "geopolitical-weekly", retries: 2, concurrency: { limit: 1 } },
  [
    { cron: geopoliticalAgent.meta.schedule },
    { event: "agent/run.requested", if: "event.data.agentName == 'geopolitical'" },
  ],
  async ({ event }) => {
    const reason =
      event && "data" in event && event.data && typeof event.data === "object"
        ? (event.data as { reason?: string }).reason
        : undefined;
    const { reportId, runId } = await runAgent(
      geopoliticalAgent,
      { reason },
      { trigger: reason ? "event" : "scheduled" },
    );
    return { reportId, runId };
  },
);
