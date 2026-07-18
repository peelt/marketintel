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
export async function isEntitledEmail(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (isOwnerEmail(e)) return true;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("app_users")
      .select("email")
      .eq("email", e)
      .maybeSingle<{ email: string }>();
    if (error) {
      console.error(`isEntitledEmail: app_users read failed: ${getErrorMessage(error)}`);
      return false; // fail closed
    }
    return data !== null;
  } catch (err) {
    console.error(`isEntitledEmail: ${getErrorMessage(err)}`);
    return false;
  }
}
