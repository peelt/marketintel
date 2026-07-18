import { inngest } from "../client";
import { dispatchHoldingAlerts } from "@/lib/alerts/dispatch";

/**
 * Holding alerts — fires on every `report/generated` event (emitted by
 * runAgent after a successful persist) and emails portfolio owners whose
 * held names the run flagged. Separate from the agent functions on purpose:
 * an email problem retries here without re-running an expensive agent, and
 * the dedupe log keeps those retries from double-sending.
 */
export const holdingAlerts = inngest.createFunction(
  { id: "holding-alerts", retries: 2 },
  { event: "report/generated" },
  async ({ event }) => {
    const { reportId, agentName } = event.data as {
      reportId: string;
      agentName: string;
    };
    if (!reportId || !agentName) return { skipped: "missing event data" };
    return dispatchHoldingAlerts({ reportId, agentName });
  },
);
