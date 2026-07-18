import { describeDelta, type Delta } from "@/lib/holdings/deltas";
import { classificationLabel } from "@/lib/format";

/**
 * Pure email composition for holding alerts — fully unit-testable, no I/O.
 *
 * Language discipline (I2, the regulatory line): every sentence describes a
 * SECURITY's classification and what changed — reusing describeDelta, the
 * same sentences the in-app feed shows, so email and UI can never diverge.
 * "You hold this name" is stated as the factual reason the email exists;
 * nothing is ever advice, urgency theatre, or a directive.
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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  const htmlBody = `
    <div style="max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;">
      <p style="font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#6b7280;">~ investorlogical · holding alert</p>
      <p style="font-size:15px;">${
        n === 1
          ? "A scheduled desk run filed a new classification on a name you hold."
          : `A scheduled desk run filed new classifications on ${n} names you hold.`
      }</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="font-size:13px;padding-top:12px;"><a href="${esc(base)}/portfolio" style="color:#034566;">your portfolio →</a></p>
      <p style="font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px;">
        You're receiving this because these names are in your Investorlogical portfolio.
        Classifications are the framework's assessment of the security with cited evidence — never a recommendation or advice.
      </p>
    </div>`;

  return { subject, textBody, htmlBody };
}
