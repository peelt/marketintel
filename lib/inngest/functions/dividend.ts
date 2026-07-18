import { inngest } from "../client";
import { dividendAgent } from "@/lib/agents/dividend/agent";
import { runAgent } from "@/lib/agents/run";

/**
 * Scheduled Dividend Intelligence run — Fri 18:00 UTC (registry schedule,
 * settled). Also listens for manual `agent/run.requested` events scoped to
 * this agent so a dev/UI trigger flows through the same code path and gets
 * the same run-lifecycle guarantees.
 *
 * runAgent creates the agent_runs row BEFORE executing and marks success
 * last, so a crash anywhere leaves an auditable failed run rather than a
 * half-persisted report.
 */
export const dividendScheduled = inngest.createFunction(
  // concurrency 1: serialise an overlapping manual + cron trigger of the
  // same agent (shared run-context).
  { id: "dividend-weekly", retries: 2, concurrency: { limit: 1 } },
  [
    { cron: dividendAgent.meta.schedule },
    { event: "agent/run.requested", if: "event.data.agentName == 'dividend'" },
  ],
  async ({ event }) => {
    const reason =
      event && "data" in event && event.data && typeof event.data === "object"
        ? (event.data as { reason?: string }).reason
        : undefined;
    const { reportId, runId } = await runAgent(
      dividendAgent,
      { reason },
      { trigger: reason ? "event" : "scheduled" },
    );
    return { reportId, runId };
  },
);
