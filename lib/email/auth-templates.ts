import { renderBrandedEmail, emailButton } from "./layout";

/**
 * Supabase auth email templates, in the house style.
 *
 * These are NOT sent by our code. Supabase composes and sends auth email
 * itself (Postmark is only the SMTP transport), so the HTML has to be pasted
 * into Supabase → Authentication → Email Templates. They live here anyway so
 * the branding stays in one place: they render through the same
 * `renderBrandedEmail` shell as every other email we send, and a drift test
 * keeps the committed .html files in `supabase/email-templates/` in step.
 *
 * `{{ .ConfirmationURL }}` is a Go template placeholder that Supabase fills at
 * send time. It must reach the dashboard UNESCAPED, so it is never passed
 * through `escapeHtml` — hence no user input goes into these builders at all.
 *
 * TWO templates, deliberately: our login calls `signInWithOtp` with
 * `shouldCreateUser: true`, so an address signing in for the FIRST time is
 * created on the spot and Supabase sends "Confirm signup" — not "Magic Link".
 * Styling only the latter would leave every newly-invited user's very first
 * email unbranded.
 */

const CONFIRMATION_URL = "{{ .ConfirmationURL }}";

export interface AuthEmailTemplate {
  /** Supabase dashboard template this belongs in. */
  target: string;
  /** Paste into the template's Subject field. */
  subject: string;
  /** Paste into the template's Message body field. */
  html: string;
}

/** Returning user asking for a link. Supabase: "Magic Link". */
export function magicLinkTemplate(): AuthEmailTemplate {
  const contentHtml = `
    <p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#034566;">Your sign-in link</p>
    <p style="margin:0 0 4px;">Click below to sign in to Investorlogical. The link works once and expires shortly; if it does, just request another from the sign-in page.</p>
    ${emailButton(CONFIRMATION_URL, "Sign in")}
    <p style="margin:8px 0 0;color:#6b7280;font-size:13px;">If you didn't request this, you can ignore it — nobody can sign in without the link.</p>`;

  return {
    target: "Magic Link",
    subject: "Your Investorlogical sign-in link",
    html: renderBrandedEmail({
      contentHtml,
      preheader: "Your one-time sign-in link for Investorlogical.",
    }),
  };
}

/** First-ever sign-in for an approved address. Supabase: "Confirm signup". */
export function confirmSignupTemplate(): AuthEmailTemplate {
  const contentHtml = `
    <p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#034566;">Confirm your email to sign in</p>
    <p style="margin:0 0 4px;">Welcome to Investorlogical. Confirm this address to finish signing in — after this, signing in is just a one-time link, no password.</p>
    ${emailButton(CONFIRMATION_URL, "Confirm and sign in")}
    <p style="margin:8px 0 0;color:#6b7280;font-size:13px;">If you didn't request this, you can ignore it — nobody can sign in without the link.</p>`;

  return {
    target: "Confirm signup",
    subject: "Confirm your email — Investorlogical",
    html: renderBrandedEmail({
      contentHtml,
      preheader: "Confirm your email to finish signing in to Investorlogical.",
    }),
  };
}

/** Every template, in the order they appear in the Supabase dashboard. */
export function authEmailTemplates(): AuthEmailTemplate[] {
  return [confirmSignupTemplate(), magicLinkTemplate()];
}
