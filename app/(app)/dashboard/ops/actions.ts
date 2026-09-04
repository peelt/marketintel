"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isOwnerEmail } from "@/lib/auth/allowlist";
import {
  approveAccessRequestEmail,
  backfillAuthAccounts,
  revokeAccessEmail,
} from "@/lib/auth/access-admin";
import { isIngestTask, runIngestTask } from "@/lib/ingest/tasks";
import { getErrorMessage } from "@/lib/errors";

/** True when the caller is a configured owner (can administer). */
async function requireOwner(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user && isOwnerEmail(user.email);
}

/**
 * Approve an access request: one click gives the address an app_users row
 * (entitlement) AND its Supabase auth account, without which the person's
 * first magic link fails. Owner-only. No env change, no redeploy, no SQL.
 */
export async function approveAccessRequest(formData: FormData): Promise<void> {
  if (!(await requireOwner())) return;
  const email = String(formData.get("email") ?? "");
  await approveAccessRequestEmail(email);

  // Welcome the newly-approved user with a branded email so they know they can
  // sign in. Fail-soft — the entitlement is already written, so a mail hiccup
  // never blocks approval (the owner can always tell them directly).
  try {
    const { sendEmail } = await import("@/lib/email/postmark");
    const { composeApprovalNotice } = await import(
      "@/lib/email/access-emails"
    );
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://investorlogical.com";
    const composed = composeApprovalNotice({ appUrl });
    await sendEmail({
      to: email.trim().toLowerCase(),
      subject: composed.subject,
      textBody: composed.textBody,
      htmlBody: composed.htmlBody,
    });
  } catch {
    // Best-effort; approval already succeeded.
  }

  revalidatePath("/dashboard/ops");
}

/** Revoke access (remove the app_users row). Owner-only. */
export async function revokeAccessRequest(formData: FormData): Promise<void> {
  if (!(await requireOwner())) return;
  const email = String(formData.get("email") ?? "");
  await revokeAccessEmail(email);
  revalidatePath("/dashboard/ops");
}

/**
 * Server action behind the Ops panel. Same authorization as every other
 * sensitive surface: a session whose email passes the allowlist (and whose
 * RLS row exists). The DEV_INGEST_SECRET is NOT involved here — that secret
 * gates the raw HTTP endpoint; this action is gated by the login session and
 * runs server-side, so the browser never handles credentials.
 */
/**
 * Give every already-approved address its missing auth account. One-off repair
 * for people approved before approval created the account; harmless after.
 */
export async function repairAuthAccounts(): Promise<
  { ok: true; created: string[] } | { ok: false; error: string }
> {
  if (!(await requireOwner())) return { ok: false, error: "not authorized" };
  try {
    const created = await backfillAuthAccounts();
    revalidatePath("/dashboard/ops");
    return { ok: true, created };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function runOpsTask(
  task: string,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isOwnerEmail(user.email)) {
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
