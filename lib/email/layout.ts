/**
 * Branded HTML shell for every outgoing email. Email clients are hostile to
 * modern CSS, so this is deliberately old-school: tables, inline styles, a
 * capped width, web-safe fallbacks. The wordmark is rendered as styled TEXT
 * (not an image) so it survives image-blocking — the two-tone "investor·
 * logical" reads on brand even with images off.
 *
 * Manifesto-White family palette (app/globals.css):
 *   navy #034566 · deep #022d42 · orange #f6881c · cyan #00b5e2 · tint #f9fafb
 */

const NAVY = "#034566";
const DEEP = "#022d42";
const CYAN = "#00b5e2";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const TINT = "#f9fafb";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A brand CTA button (table-based so it renders in Outlook too). */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr><td style="border-radius:6px;background:${NAVY};">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 22px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

export interface BrandedEmail {
  /** Inner content HTML (already trusted/escaped by the caller). */
  contentHtml: string;
  /** Hidden inbox-preview line. */
  preheader?: string;
  /** Small muted footer line under the standard sign-off. */
  footerNote?: string;
}

export function renderBrandedEmail({
  contentHtml,
  preheader,
  footerNote,
}: BrandedEmail): string {
  const wordmark = `<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:-0.5px;"><span style="color:${CYAN};">investor</span><span style="color:${NAVY};">logical</span></span>`;

  return `<!-- ${preheader ? escapeHtml(preheader) : "Investorlogical"} -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader ? escapeHtml(preheader) : ""}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TINT};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
      <tr><td style="padding:20px 28px;border-bottom:1px solid ${BORDER};">
        ${wordmark}
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:${MUTED};margin-top:2px;">~ glass-box investment research</div>
      </td></tr>
      <tr><td style="padding:24px 28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#111827;">
        ${contentHtml}
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid ${BORDER};font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};background:${TINT};">
        ${footerNote ? `${footerNote}<br><br>` : ""}
        Investorlogical — <span style="color:${DEEP};">investorlogical.com</span>. Analysis with cited evidence, never advice or a recommendation.
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
