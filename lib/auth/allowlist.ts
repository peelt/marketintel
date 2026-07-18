/**
 * Auth allowlist: only addresses in AUTH_ALLOWED_EMAIL may sign in.
 *
 * AUTH_ALLOWED_EMAIL is a COMMA-SEPARATED list — one address (no comma) behaves
 * exactly as before; more than one lets several users in. This is the app-layer
 * half of the entitlement; the database half is the `app_users` table checked by
 * RLS (migration 0003). BOTH must agree — a new user needs their address here
 * AND a seeded `app_users` row, or they'll pass the form but read nothing.
 *
 * Supabase Auth itself doesn't enforce an allowlist — anyone could request a
 * magic link to any address. We enforce here before sending the OTP and again
 * in the auth callback before issuing the session.
 */
export function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowedEmails().includes(email.trim().toLowerCase());
}

/** First allowed address, for the dev-hint display. Null when none configured. */
export function getAllowedEmail(): string | null {
  return allowedEmails()[0] ?? null;
}
