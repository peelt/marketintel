import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";

/**
 * Owner-side administration of access requests. Service-role only (both
 * `access_requests` and `app_users` are service-role-managed). Callers MUST
 * gate on isOwnerEmail before invoking these — nothing here checks identity.
 */

export interface AccessRequestView {
  email: string;
  note: string | null;
  createdAt: string;
  approved: boolean; // already has an app_users row
}

/** All requests, newest first, each marked whether it's already approved. */
export async function listAccessRequests(): Promise<AccessRequestView[]> {
  const supabase = createServiceClient();
  const [reqRes, userRes] = await Promise.all([
    supabase
      .from("access_requests")
      .select("email, note, created_at")
      .order("created_at", { ascending: false })
      .returns<{ email: string; note: string | null; created_at: string }[]>(),
    supabase.from("app_users").select("email").returns<{ email: string }[]>(),
  ]);
  if (reqRes.error) throw new Error(`listAccessRequests: ${getErrorMessage(reqRes.error)}`);
  if (userRes.error) throw new Error(`listAccessRequests users: ${getErrorMessage(userRes.error)}`);

  const approved = new Set((userRes.data ?? []).map((u) => u.email.toLowerCase()));
  return (reqRes.data ?? []).map((r) => ({
    email: r.email,
    note: r.note,
    createdAt: r.created_at,
    approved: approved.has(r.email.toLowerCase()),
  }));
}

/**
 * Approve an email: give it an `app_users` row, which is all it takes to be
 * entitled. Idempotent. The user is auto-provisioned in auth.users on their
 * first magic-link login (shouldCreateUser), so there is NOTHING else to do —
 * no Supabase user creation, no env change, no redeploy.
 */
export async function approveAccessRequestEmail(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
    throw new Error("approveAccessRequestEmail: not a valid email");
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("app_users")
    .upsert({ email: e }, { onConflict: "email", ignoreDuplicates: true });
  if (error) throw new Error(`approveAccessRequestEmail: ${getErrorMessage(error)}`);
}

/** Revoke: remove the app_users row. Idempotent. Owners can't be revoked here. */
export async function revokeAccessEmail(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const supabase = createServiceClient();
  const { error } = await supabase.from("app_users").delete().eq("email", e);
  if (error) throw new Error(`revokeAccessEmail: ${getErrorMessage(error)}`);
}
