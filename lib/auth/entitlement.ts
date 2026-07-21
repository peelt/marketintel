import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";
import { isOwnerEmail } from "./allowlist";

/**
 * Who may use the product. The live allowlist is the DATABASE (`app_users`),
 * NOT an env var — so onboarding a user is a one-click Approve in Setup, never
 * a redeploy. An address is entitled when it's either a configured OWNER (env
 * bootstrap) or has an `app_users` row (approved). Owners are entitled without
 * needing an app_users row so the very first sign-in is never locked out.
 *
 * Server-only: reads `app_users` with the service-role client (that table has
 * no RLS policies — service role only). Never import into a client component.
 * The database RLS (`is_app_user()`) is the real data boundary; this is the
 * app-layer gate for sending the magic link and routing/redirecting.
 */
// The app_users read runs on every page load (the entitlement gate). Entitlement
// changes rarely, so memoise it per-email with a short TTL — this removes one DB
// round-trip from every navigation. A freshly-approved user waits at most the TTL
// (and is signing in fresh anyway); a revoked user keeps access for at most the
// TTL. Only the DB-read path is cached; the owner check stays a synchronous env
// lookup below.
const ENTITLE_TTL_MS = 60 * 1000;
const entitleCache = new Map<string, { ok: boolean; at: number }>();

/** Clear the entitlement cache (tests; harmless in prod). */
export function clearEntitlementCache(): void {
  entitleCache.clear();
}

export async function isEntitledEmail(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (isOwnerEmail(e)) return true;

  const cached = entitleCache.get(e);
  if (cached && Date.now() - cached.at < ENTITLE_TTL_MS) return cached.ok;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("app_users")
      .select("email")
      .eq("email", e)
      .maybeSingle<{ email: string }>();
    if (error) {
      console.error(`isEntitledEmail: app_users read failed: ${getErrorMessage(error)}`);
      return false; // fail closed — not cached, so it retries next time
    }
    const ok = data !== null;
    entitleCache.set(e, { ok, at: Date.now() });
    return ok;
  } catch (err) {
    console.error(`isEntitledEmail: ${getErrorMessage(err)}`);
    return false;
  }
}
