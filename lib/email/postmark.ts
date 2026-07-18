import { getErrorMessage } from "@/lib/errors";

/**
 * Postmark adapter — the MXMG family's transactional email provider.
 * Server-only; never import from client components.
 *
 * Fail-soft by design: alerting is a notification layer on top of reports
 * that are already persisted and visible in-app. A missing key or a Postmark
 * outage must never fail an agent run — sendEmail returns false and logs,
 * nothing throws.
 *
 * Env: POSTMARK_SERVER_TOKEN (server token, not account token) and
 * POSTMARK_FROM_EMAIL (a sender signature / domain verified in Postmark).
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

export function postmarkReadiness(): string | null {
  if (!process.env.POSTMARK_SERVER_TOKEN) return "POSTMARK_SERVER_TOKEN not set";
  if (!process.env.POSTMARK_FROM_EMAIL) return "POSTMARK_FROM_EMAIL not set";
  return null;
}

export async function sendEmail(email: OutboundEmail): Promise<boolean> {
  const notReady = postmarkReadiness();
  if (notReady) {
    console.warn(`postmark: not configured (${notReady}) — email not sent`);
    return false;
  }
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN!,
      },
      body: JSON.stringify({
        From: process.env.POSTMARK_FROM_EMAIL,
        To: email.to,
        Subject: email.subject,
        TextBody: email.textBody,
        ...(email.htmlBody ? { HtmlBody: email.htmlBody } : {}),
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? "outbound",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`postmark: send failed ${res.status}: ${body.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`postmark: send failed: ${getErrorMessage(err)}`);
    return false;
  }
}
