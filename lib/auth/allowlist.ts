/**
 * Single-user auth: only the email in AUTH_ALLOWED_EMAIL may sign in.
 *
 * Supabase Auth itself doesn't enforce an allowlist — anyone could request a
 * magic link to any address. We enforce here before sending the OTP and again
 * in the auth callback before issuing the session.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = process.env.AUTH_ALLOWED_EMAIL?.trim().toLowerCase();
  if (!allowed) return false;
  return email.trim().toLowerCase() === allowed;
}

export function getAllowedEmail(): string | null {
  return process.env.AUTH_ALLOWED_EMAIL?.trim().toLowerCase() ?? null;
}
