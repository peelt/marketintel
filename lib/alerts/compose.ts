import { describeDelta, type Delta } from "@/lib/holdings/deltas";
import { classificationLabel } from "@/lib/format";
import { renderBrandedEmail, escapeHtml as esc } from "@/lib/email/layout";

/**
 * Pure email composition for holding alerts — fully unit-testable, no I/O.
 *
 * Language discipline (I2, the regulatory line): every sentence describes a
 * SECURITY's classification and what changed — reusing describeDelta, the
 * same sentences the in-app feed shows, so email and UI can never diverge.
 * "You hold this name" is stated as the factual reason the email exists;
 * nothing is ever advice, urgency theatre, or a directive.
 *
 * The HTML body is wrapped in the shared branded shell (lib/email/layout) so
 * every outgoing email carries the same investorlogical chrome.
 */

export interface AlertItem {
  ticker: string;
  name: string;
  agentDisplay: string;
  delta: Delta;
}

export interface ComposedAlert {
  subject: string;
  textBody: string;
  htmlBody: string;
}

export function composeAlertEmail(
  items: AlertItem[],
  appUrl: string,
): ComposedAlert | null {
  if (items.length === 0) return null;
  const base = appUrl.replace(/\/+$/, "");
  const n = items.length;

  const subject =
    n === 1
      ? `${items[0].ticker}: a desk changed its classification`
      : `${n} of your held names have new classifications`;

  const lines = items.map((item) => {
    const sentence = describeDelta(item.delta, item.ticker, item.agentDisplay);
    const reportId = item.delta.latest?.reportId;
    const link = reportId ? `${base}/reports/${reportId}` : `${base}/reports`;
    return { item, sentence, link };
  });

  const textBody = [
    n === 1
      ? "A scheduled desk run filed a new classification on a name you hold."
      : `A scheduled desk run filed new classifications on ${n} names you hold.`,
    "",
    ...lines.map(
      (l) => `- ${l.sentence}\n  Report and evidence: ${l.link}`,
    ),
    "",
    `Portfolio view: ${base}/portfolio`,
    "",
    "You're receiving this because these names are in your Investorlogical portfolio. Classifications are the framework's assessment of the security with cited evidence — never a recommendation or advice.",
  ].join("\n");

  const rows = lines
    .map(
      (l) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #e5e7eb;">
            <div style="font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:bold;color:#034566;">
              ${esc(l.item.ticker)}
              <span style="font-weight:normal;color:#6b7280;"> ${esc(l.item.name)}</span>
              ${
                l.item.delta.latest?.classification
                  ? `<span style="color:#111;"> · ${esc(classificationLabel(l.item.delta.latest.classification))}</span>`
                  : ""
              }
            </div>
            <div style="font-size:14px;color:#111;padding-top:2px;">${esc(l.sentence)}</div>
            <div style="font-size:13px;padding-top:4px;"><a href="${esc(l.link)}" style="color:#034566;">open the report and evidence →</a></div>
          </td>
        </tr>`,
    )
    .join("");

  const contentHtml = `
      <p style="margin:0 0 12px;">${
        n === 1
          ? "A scheduled desk run filed a new classification on a name you hold."
          : `A scheduled desk run filed new classifications on ${n} names you hold.`
      }</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="font-size:13px;padding-top:12px;margin:12px 0 0;"><a href="${esc(base)}/portfolio" style="color:#034566;">your portfolio →</a></p>`;

  const htmlBody = renderBrandedEmail({
    contentHtml,
    preheader:
      n === 1
        ? `${items[0].ticker}: a desk changed its classification`
        : `${n} of your held names have new classifications`,
    footerNote:
      "You're receiving this because these names are in your Investorlogical portfolio.",
  });

  return { subject, textBody, htmlBody };
}
