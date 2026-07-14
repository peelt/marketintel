"use server";

import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { isIngestTask, runIngestTask } from "@/lib/ingest/tasks";
import { getErrorMessage } from "@/lib/errors";

/**
 * Server action behind the Ops panel. Same authorization as every other
 * sensitive surface: a session whose email passes the allowlist (and whose
 * RLS row exists). The DEV_INGEST_SECRET is NOT involved here — that secret
 * gates the raw HTTP endpoint; this action is gated by the login session and
 * runs server-side, so the browser never handles credentials.
 */
export async function runOpsTask(
  task: string,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) {
    return { ok: false, error: "forbidden" };
  }
  if (!isIngestTask(task)) {
    return { ok: false, error: `unknown task: ${task}` };
  }

  try {
    return { ok: true, result: await runIngestTask(task) };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}
