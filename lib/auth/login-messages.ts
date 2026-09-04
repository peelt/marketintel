/**
 * House-voice copy for magic-link failures.
 *
 * `signInWithOtp` errors were rendered raw, so a user who asked for a second
 * link inside the per-user interval saw Supabase's own string ("For security
 * purposes, you can only request this after 47 seconds") in the middle of the
 * desk's mono voice. These are the states a real person actually hits; the
 * fallback keeps the provider's wording rather than swallowing a fault we
 * haven't seen, because a vague "something went wrong" is worse than an ugly
 * true sentence.
 *
 * Pure; unit-tested.
 */

/** Supabase's per-user interval message carries the seconds to wait. */
function secondsToWait(raw: string): number | null {
  const m = /after (\d+) seconds?/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function loginErrorMessage(raw: string): string {
  const s = raw.trim();
  if (!s) return "That didn't send — try again in a moment.";
  const low = s.toLowerCase();

  // Asked again too soon. The project sets a minimum interval between emails
  // to the same address; say the wait rather than the mechanism.
  const wait = secondsToWait(s);
  if (wait !== null) {
    return `a link was just sent to that address — you can request another in ${wait} second${wait === 1 ? "" : "s"}.`;
  }
  if (low.includes("rate limit") || low.includes("too many")) {
    return "too many sign-in emails just went out — wait a minute and try again.";
  }
  // The send itself failed upstream (bad SMTP credentials, unverified sender).
  // The user can't fix this; say so plainly instead of implying they can.
  if (low.includes("error sending") || low.includes("smtp")) {
    return "the sign-in email couldn't be sent — that's our end, not yours. Try again shortly.";
  }
  return s;
}
