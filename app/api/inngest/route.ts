import { NextResponse } from "next/server";
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";

/**
 * Inngest serves and signs invocations at this route. Functions get added to
 * the array as they're built in subsequent PRs.
 *
 * Local dev: run `npx inngest-cli@latest dev` and point it at
 * http://localhost:3000/api/inngest. No INNGEST_* env vars needed locally.
 *
 * Fail closed in production: without a signing key the serve handler would
 * accept unsigned invocations — and registered functions run with the
 * service-role client. Better a dead endpoint than an open one. (Checked per
 * request, not at module load, so builds don't require the key.)
 */
const handler = serve({
  client: inngest,
  functions: [
    // PR 4+ — agent orchestrator, individual scheduled functions
  ],
});

type RouteHandler = (req: Request) => Promise<Response> | Response;

function failClosed(fn: RouteHandler): RouteHandler {
  return (req) => {
    if (
      process.env.NODE_ENV === "production" &&
      !process.env.INNGEST_SIGNING_KEY
    ) {
      return NextResponse.json(
        { error: "INNGEST_SIGNING_KEY is not configured" },
        { status: 503 },
      );
    }
    return fn(req);
  };
}

export const GET = failClosed(handler.GET as RouteHandler);
export const POST = failClosed(handler.POST as RouteHandler);
export const PUT = failClosed(handler.PUT as RouteHandler);
