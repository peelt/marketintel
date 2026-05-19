import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";

/**
 * Inngest serves and signs invocations at this route. Functions get added to
 * the array as they're built in subsequent PRs.
 *
 * Local dev: run `npx inngest-cli@latest dev` and point it at
 * http://localhost:3000/api/inngest. No INNGEST_* env vars needed locally.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // PR 3+ — agent orchestrator, individual scheduled functions
  ],
});
