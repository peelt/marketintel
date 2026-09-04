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
 * Approve an email: an `app_users` row (entitlement) AND the Supabase auth
 * account itself.
 *
 * The account creation is the load-bearing half. The login calls
 * `signInWithOtp`, which can only auto-provision a first-time address when the
 * project allows signups — and signups are deliberately disabled here. So
 * approval used to leave people entitled but with no account, and their first
 * magic link failed with "Signups not allowed for this instance". Two of the
 * three approved users were stuck that way for seven weeks; it went unnoticed
 * because the owner's own account predates the change and his session simply
 * kept refreshing.
 *
 * Created pre-confirmed: the owner approving the address IS the verification,
 * and an unconfirmed account would just move the failure one step later.
 * Idempotent — an existing account is left exactly as it is.
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
  await ensureAuthAccount(e);
}

/**
 * Does this creation error just mean "the account is already there"? That is
 * success for our purposes — approving someone twice, or an owner who has
 * signed in before, must not surface as a failure. Pure; unit-tested.
 */
export function isAlreadyRegistered(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already") ||
    m.includes("registered") ||
    m.includes("exists") ||
    // A raw unique violation is the same fact arriving from Postgres.
    m.includes("duplicate")
  );
}

/**
 * Give an entitled address a Supabase auth account if it hasn't got one.
 * Idempotent and fail-soft on "already exists" — approval must not break just
 * because the person has signed in before.
 */
export async function ensureAuthAccount(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const supabase = createServiceClient();
  const { error } = await supabase.auth.admin.createUser({
    email: e,
    email_confirm: true,
  });
  if (!error) return;
  if (isAlreadyRegistered(getErrorMessage(error))) return;
  throw new Error(`ensureAuthAccount: ${getErrorMessage(error)}`);
}

/**
 * Give every entitled address an auth account, for the ones approved before
 * approval created it. Returns the addresses it had to provision. Fail-soft
 * per address: one bad row must not abandon the rest.
 */
export async function backfillAuthAccounts(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("email")
    .returns<{ email: string }[]>();
  if (error) throw new Error(`backfillAuthAccounts: ${getErrorMessage(error)}`);

  const { data: existing } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const have = new Set(
    (existing?.users ?? []).map((u) => (u.email ?? "").toLowerCase()),
  );

  const created: string[] = [];
  for (const row of data ?? []) {
    const e = row.email.trim().toLowerCase();
    if (have.has(e)) continue;
    try {
      await ensureAuthAccount(e);
      created.push(e);
    } catch (err) {
      console.error(`backfillAuthAccounts(${e}): ${getErrorMessage(err)}`);
    }
  }
  return created;
}

/** Revoke: remove the app_users row. Idempotent. Owners can't be revoked here. */
export async function revokeAccessEmail(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const supabase = createServiceClient();
  const { error } = await supabase.from("app_users").delete().eq("email", e);
  if (error) throw new Error(`revokeAccessEmail: ${getErrorMessage(error)}`);
}
