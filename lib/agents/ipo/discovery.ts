import {
  fetchFilingPrimaryDocument,
  resolvePrimaryDocumentUrl,
  searchFilings,
  splitFilingSections,
} from "@/lib/data-sources/sec-edgar";
import type { RawFiling, RawFilingSection } from "@/lib/data-sources/types";
import { getErrorMessage } from "@/lib/errors";

/**
 * IPO desk discovery: fresh S-1/F-1 registration statements from EDGAR
 * full-text search, one per issuer, capped so a busy filing week can't blow
 * the run budget. Amendments (S-1/A) are deliberately out of scope for v1 —
 * the original registration is the "new name in the pipeline" signal this
 * desk trades on, and the accession-aware eval cache re-grades automatically
 * if that decision changes later.
 */

export const IPO_WINDOW_DAYS = 30;
export const MAX_ISSUERS = 25;

/** One filing per issuer — the LATEST when a CIK filed more than once. */
export function dedupeByCik(filings: RawFiling[]): RawFiling[] {
  const byCik = new Map<string, RawFiling>();
  for (const f of filings) {
    if (!f.issuerCik) continue;
    const existing = byCik.get(f.issuerCik);
    if (!existing || f.filedAt > existing.filedAt) byCik.set(f.issuerCik, f);
  }
  return [...byCik.values()].sort((a, b) => b.filedAt.localeCompare(a.filedAt));
}

/**
 * EFTS display names carry identifiers the UI shouldn't: "Acme Corp  (ACME)
 * (CIK 0001234567)". Strip the parenthesised tail(s) back to the plain name.
 */
export function cleanIssuerName(name: string): string {
  return name
    .replace(/\s*\((CIK\s+)?\d{7,10}\)\s*$/i, "")
    .replace(/\s*\(CIK\s+\d+\)\s*$/i, "")
    .replace(/\s*\([A-Z][A-Z0-9., -]{0,14}\)\s*$/, "")
    .trim();
}

export async function discoverIpoFilings(
  now: Date = new Date(),
): Promise<RawFiling[]> {
  const dateFrom = new Date(now.getTime() - IPO_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const raw = await searchFilings({
    forms: ["S-1", "F-1"],
    dateFrom,
    dateTo: now.toISOString().slice(0, 10),
    max: 80,
  });
  return dedupeByCik(raw).slice(0, MAX_ISSUERS);
}

// ---------- prospectus excerpt assembly (pure) ----------

/**
 * Per-section character budgets for the evaluation prompt. The order is the
 * order sections appear in the prompt; risk factors and the summary carry the
 * most signal so they get the biggest budgets. Total ≈ 95k chars ≈ 25k tokens
 * — comfortably inside the routine tier's context.
 */
const SECTION_BUDGETS: ReadonlyArray<readonly [string, number]> = [
  ["prospectus_summary", 12_000],
  ["risk_factors", 18_000],
  ["use_of_proceeds", 5_000],
  ["dividend_policy", 2_500],
  ["capitalization", 4_000],
  ["dilution", 4_000],
  ["management_s_discussion_and_analysis", 14_000],
  ["business", 14_000],
  ["management", 6_000],
  ["executive_compensation", 3_000],
  ["principal_stockholders", 3_000],
  ["principal_shareholders", 3_000],
  ["description_of_capital_stock", 5_000],
  ["underwriting", 4_000],
];

/** Cover-page chars to include — offering size, share count, proposed ticker. */
const PROLOGUE_BUDGET = 3_000;

/**
 * A prospectus we can honestly evaluate must expose at least two of its
 * core narrative sections; anything less and the sectioniser only found
 * boilerplate, so the desk skips the name rather than grading a cover page.
 */
const CORE_SECTIONS = [
  "prospectus_summary",
  "risk_factors",
  "business",
  "management_s_discussion_and_analysis",
];

/**
 * Assemble the LLM evaluation excerpt from sectionised filing text. Pure —
 * exported for tests. Null = unreadable (too few core sections), and the
 * agent reports the name as skipped instead of fabricating grades.
 */
export function assembleProspectusExcerpt(
  sections: RawFilingSection[],
): string | null {
  const byName = new Map(sections.map((s) => [s.sectionName, s.content]));
  const coreFound = CORE_SECTIONS.filter((name) => byName.has(name));
  if (coreFound.length < 2) return null;

  const parts: string[] = [];
  const prologue = byName.get("prologue");
  if (prologue) {
    parts.push(`## COVER PAGE\n\n${prologue.slice(0, PROLOGUE_BUDGET)}`);
  }
  for (const [name, budget] of SECTION_BUDGETS) {
    const content = byName.get(name);
    if (!content) continue;
    const heading = name.replace(/_/g, " ").toUpperCase();
    const truncated =
      content.length > budget ? `${content.slice(0, budget)} […truncated]` : content;
    parts.push(`## ${heading}\n\n${truncated}`);
  }
  return parts.join("\n\n");
}

// ---------- filing → excerpt (network) ----------

export interface ReadableFiling {
  filing: RawFiling;
  /** URL of the resolved primary document (the actual prospectus HTML). */
  documentUrl: string;
  excerpt: string;
}

/**
 * Resolve, fetch and sectionise one filing. Null = unreadable for any reason
 * (no primary doc, fetch failure, too few sections) — logged, never thrown,
 * so one broken filing can't sink the weekly run.
 */
export async function readProspectus(
  filing: RawFiling,
): Promise<ReadableFiling | null> {
  if (!filing.issuerCik || !filing.accessionNumber) return null;
  try {
    const documentUrl = await resolvePrimaryDocumentUrl(
      filing.issuerCik,
      filing.accessionNumber,
    );
    if (!documentUrl) {
      console.warn(`ipo discovery: no primary document for ${filing.accessionNumber}`);
      return null;
    }
    const html = await fetchFilingPrimaryDocument({ url: documentUrl });
    const sections = splitFilingSections(filing.accessionNumber, html);
    const excerpt = assembleProspectusExcerpt(sections);
    if (!excerpt) {
      console.warn(
        `ipo discovery: prospectus unreadable (too few sections) for ${filing.accessionNumber}`,
      );
      return null;
    }
    return { filing, documentUrl, excerpt };
  } catch (err) {
    console.warn(
      `ipo discovery: failed to read ${filing.accessionNumber}: ${getErrorMessage(err)}`,
    );
    return null;
  }
}
