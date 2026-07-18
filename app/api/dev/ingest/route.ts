import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwnerEmail } from "@/lib/auth/allowlist";
import { isIngestTask, runIngestTask } from "@/lib/ingest/tasks";
import { getErrorMessage } from "@/lib/errors";

/**
 * Dev/manual ingest endpoint. Thin auth wrapper over lib/ingest/tasks.ts —
 * the dashboard Ops panel drives the same task runner via server actions.
 *
 * POST /api/dev/ingest?task=<task>   (see INGEST_TASKS for the list;
 * no task / task=status is the readiness probe with no side effects)
 *
 * POST (not GET) because every task except `status` mutates state and fans
 * out to external APIs — a cookie-authenticated GET was CSRF-able via a
 * simple <img> tag. In production the route additionally requires the
 * x-dev-ingest-secret header to match DEV_INGEST_SECRET (unset = disabled in
 * production). Scheduled ingest belongs to Inngest jobs, not this route.
 */

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.DEV_INGEST_SECRET;
    if (!secret || request.headers.get("x-dev-ingest-secret") !== secret) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isOwnerEmail(user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const task = request.nextUrl.searchParams.get("task") ?? "status";
  if (!isIngestTask(task)) {
    return NextResponse.json({ error: `unknown task: ${task}` }, { status: 400 });
  }

  try {
    return NextResponse.json(await runIngestTask(task));
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
