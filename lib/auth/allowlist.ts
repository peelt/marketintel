/**
 * OWNER identities (env). AUTH_ALLOWED_EMAIL is a comma-separated list of the
 * product's owners/admins — the bootstrap identities that can always sign in
 * AND administer (Setup, approving other users). This list changes rarely (a
 * redeploy for a new owner is fine).
 *
 * Everyday users are NOT here — they live in the `app_users` table and are
 * approved with one click in Setup (see lib/auth/entitlement.ts). So the
 * env var is just the owner set; onboarding a user never touches it.
 */
export function ownerEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** True when the email is a configured OWNER (can administer). */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ownerEmails().includes(email.trim().toLowerCase());
}

/** First owner address, for the dev-hint display. Null when none configured. */
export function getOwnerEmail(): string | null {
  return ownerEmails()[0] ?? null;
}
