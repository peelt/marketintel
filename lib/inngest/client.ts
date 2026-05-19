import { Inngest } from "inngest";

/**
 * Inngest client. Functions are registered via the route handler at
 * /api/inngest. Long-running agent jobs live in lib/inngest/functions/ and get
 * exported into the route handler as they're built (PR 3+).
 */
export const inngest = new Inngest({
  id: "marketintel",
  // EventKey/SigningKey are read from env at runtime in production.
});

/** Event names emitted into Inngest. Keep strongly typed. */
export type InngestEvent =
  | { name: "agent/run.requested"; data: { agentName: string; reason?: string } }
  | { name: "report/generated"; data: { reportId: string; agentName: string } };
