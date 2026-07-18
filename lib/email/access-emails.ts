import { renderBrandedEmail, emailButton, escapeHtml } from "./layout";

/**
 * Pure composers (subject + text + branded HTML) for the two access emails:
 * the owner notice when someone requests access, and the welcome the user
 * gets when the owner approves them. No I/O — unit-testable.
 */

export interface ComposedEmail {
  subject: string;
  textBody: string;
  htmlBody: string;
}

function baseUrl(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

/** Owner notification: "someone requested access — approve in Setup." */
export function composeAccessRequestNotice(input: {
  requesterEmail: string;
  note: string | null;
  appUrl: string;
}): ComposedEmail {
  const base = baseUrl(input.appUrl);
  const subject = `Access request — ${input.requesterEmail}`;
  const textBody = [
    `New access request on investorlogical.com`,
    ``,
    `Email: ${input.requesterEmail}`,
    input.note ? `Note: ${input.note}` : `Note: (none)`,
    ``,
    `To grant access: open Setup (${base}/dashboard/ops) → access requests → Approve. That's it — they can sign in immediately.`,
  ].join("\n");

  const contentHtml = `
    <p style="margin:0 0 12px;">Someone requested access to Investorlogical.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 4px;font-size:15px;">
      <tr><td style="padding:2px 0;color:#6b7280;">Email</td><td style="padding:2px 0 2px 14px;font-family:ui-monospace,Menlo,monospace;color:#034566;font-weight:700;">${escapeHtml(input.requesterEmail)}</td></tr>
      <tr><td style="padding:2px 0;color:#6b7280;vertical-align:top;">Note</td><td style="padding:2px 0 2px 14px;">${input.note ? escapeHtml(input.note) : "<span style='color:#6b7280;'>(none)</span>"}</td></tr>
    </table>
    ${emailButton(`${base}/dashboard/ops`, "Open Setup → approve")}
    <p style="margin:8px 0 0;color:#6b7280;font-size:13px;">One click approves them — no redeploy, no SQL.</p>`;

  return {
    subject,
    textBody,
    htmlBody: renderBrandedEmail({
      contentHtml,
      preheader: `New access request from ${input.requesterEmail}`,
    }),
  };
}

/** User welcome: "you've been approved — sign in." */
export function composeApprovalNotice(input: { appUrl: string }): ComposedEmail {
  const base = baseUrl(input.appUrl);
  const subject = "You're approved — sign in to Investorlogical";
  const textBody = [
    `You've been approved for Investorlogical.`,
    ``,
    `Sign in here: ${base}/login`,
    ``,
    `Enter your email and we'll send a one-time magic link — no password. Investorlogical files evidence-backed research from scheduled specialist desks; add the names you own to hear what changed on them.`,
  ].join("\n");

  const contentHtml = `
    <p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#034566;">You're in.</p>
    <p style="margin:0 0 4px;">Your access to Investorlogical has been approved. Sign in whenever you like — enter your email and we'll send a one-time magic link, no password.</p>
    ${emailButton(`${base}/login`, "Sign in")}
    <p style="margin:8px 0 0;color:#6b7280;font-size:13px;">Once you're in, add the names you own and each scheduled run tells you what changed on them.</p>`;

  return {
    subject,
    textBody,
    htmlBody: renderBrandedEmail({
      contentHtml,
      preheader: "Your Investorlogical access has been approved — sign in.",
    }),
  };
}
