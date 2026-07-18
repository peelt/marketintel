/**
 * Validation for the public request-access form. Pure — exported for tests.
 *
 * Outcomes:
 *   { kind: "valid" }  — process the request
 *   { kind: "silent" } — pretend success, do nothing (honeypot tripped: a
 *                        bot filled the invisible field; humans can't)
 *   { kind: "invalid" }— show the message
 *
 * The DB enforces the same bounds (migration 0014) — this layer exists for
 * friendly messages, not as the security boundary.
 */

export type AccessRequestValidation =
  | { kind: "valid"; email: string; note: string | null }
  | { kind: "silent" }
  | { kind: "invalid"; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateAccessRequest(input: {
  email: unknown;
  note: unknown;
  honeypot: unknown;
}): AccessRequestValidation {
  // Bots fill every field; the "company" field is invisible to humans.
  if (typeof input.honeypot === "string" && input.honeypot.trim().length > 0) {
    return { kind: "silent" };
  }

  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return { kind: "invalid", error: "That doesn't look like an email address." };
  }

  const rawNote = String(input.note ?? "").trim();
  if (rawNote.length > 500) {
    return { kind: "invalid", error: "Keep the note under 500 characters." };
  }

  return { kind: "valid", email, note: rawNote.length > 0 ? rawNote : null };
}
