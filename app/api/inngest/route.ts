import { NextResponse } from "next/server";
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { dividendScheduled } from "@/lib/inngest/functions/dividend";
import { chunkedIngest } from "@/lib/inngest/functions/ingest";
import { holdingAlerts } from "@/lib/inngest/functions/alerts";
import { geopoliticalScheduled } from "@/lib/inngest/functions/geopolitical";
import { ipoScheduled } from "@/lib/inngest/functions/ipo";
import { metalsScheduled } from "@/lib/inngest/functions/metals";
import {
  dailyPriceRefresh,
  reactionScheduled,
} from "@/lib/inngest/functions/reaction";
import { weeklyDataRefresh } from "@/lib/inngest/functions/refresh";

// Agent runs fan out to data providers and the LLM. The Metals desk is the
// long pole: ~23 deep-tier web-research calls ≈ 6–10 minutes in one
// invocation, so take the platform's full budget (Vercel Pro + Fluid compute
// allows 800s), not the 300s that killed the first live run.
export const maxDuration = 800;

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
    dividendScheduled,
    chunkedIngest,
    reactionScheduled,
    dailyPriceRefresh,
    weeklyDataRefresh,
    metalsScheduled,
    ipoScheduled,
    geopoliticalScheduled,
    holdingAlerts,
  ],
  // Pin the public custom domain as the serve host on PRODUCTION deploys only.
  // Vercel's per-deployment URL (investorlogical-<hash>-mxmg-projects.vercel.app)
  // sits behind Deployment Protection and returns 401 to Inngest, so every
  // auto-sync on deploy silently fails into "Unattached syncs" — the app only
  // updates when someone resyncs by hand against investorlogical.com. Advertising
  // the public, unprotected domain during the sync handshake makes deploys
  // self-sync. Gated on VERCEL_ENV so preview deploys (which sync to Inngest
  // branch envs) and local dev (http://localhost:3000) are untouched.
  serveHost:
    process.env.VERCEL_ENV === "production"
      ? (process.env.NEXT_PUBLIC_APP_URL ?? "https://investorlogical.com")
      : undefined,
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
