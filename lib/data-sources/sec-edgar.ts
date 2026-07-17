import { httpJson, httpText } from "./http";
import type {
  AdapterCapabilities,
  RawFiling,
  RawFilingSection,
} from "./types";

/**
 * SEC EDGAR adapter.
 *
 * Free. Identification required: every request must carry a User-Agent of the
 * form "Sample Name AdminContact@samplecompany.com". Set via SEC_EDGAR_USER_AGENT.
 *
 * SEC rate limit: 10 req/sec per IP. We throttle to 150 ms host gap as a
 * conservative ceiling (~6.6 rps).
 *
 * Reference: https://www.sec.gov/os/accessing-edgar-data
 */

const HOST_BASE = "https://www.sec.gov";
const DATA_BASE = "https://data.sec.gov";
const EFTS_BASE = "https://efts.sec.gov"; // full-text search
const HOST_THROTTLE_MS = 150;

function userAgent(): string {
  const ua = process.env.SEC_EDGAR_USER_AGENT;
  if (!ua) {
    throw new Error(
      "SEC_EDGAR_USER_AGENT must be set (format: 'Name email@example.com')",
    );
  }
  return ua;
}

// ---------- types from the EDGAR JSON endpoints (only what we use) ----------

interface EdgarRecentFilings {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  form: string[];
  primaryDocument: string[];
  isXBRL: number[];
  isInlineXBRL: number[];
}

interface EdgarSubmissionsResponse {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  filings: { recent: EdgarRecentFilings };
}

interface EdgarFullTextHit {
  _source: {
    adsh: string;
    ciks: string[];
    display_names: string[];
    form: string;
    file_date: string;
    file_type: string;
  };
}

interface EdgarFullTextResponse {
  hits: { hits: EdgarFullTextHit[]; total: { value: number } };
}

// ---------- public API ----------

/**
 * Fetch the most recent N filings for a given issuer CIK. Returns normalised
 * RawFiling records, not raw content — call `fetchFilingPrimaryDocument` to
 * get the document body for parsing.
 */
export async function fetchRecentFilings(
  cik: string,
  options: { types?: string[]; max?: number } = {},
): Promise<RawFiling[]> {
  const padded = cik.padStart(10, "0");
  const url = `${DATA_BASE}/submissions/CIK${padded}.json`;

  const data = await httpJson<EdgarSubmissionsResponse>(url, {
    userAgent: userAgent(),
    hostThrottleMs: HOST_THROTTLE_MS,
    // EDGAR intermittently 403s well-formed requests; retry through it.
    retryStatuses: [403],
  });

  const r = data.filings.recent;
  const allowedTypes = options.types?.map((t) => t.toUpperCase());
  const out: RawFiling[] = [];

  for (let i = 0; i < r.accessionNumber.length; i++) {
    const form = r.form[i];
    if (allowedTypes && !allowedTypes.includes(form.toUpperCase())) continue;

    const accession = r.accessionNumber[i];
    const accessionDashless = accession.replace(/-/g, "");
    const primaryDoc = r.primaryDocument[i];

    out.push({
      issuerName: data.name,
      issuerCik: padded,
      ticker: data.tickers[0],
      exchange: data.exchanges[0],
      source: "sec_edgar",
      filingType: form,
      filedAt: `${r.filingDate[i]}T00:00:00Z`,
      periodEnd: r.reportDate[i] || undefined,
      url: `${HOST_BASE}/Archives/edgar/data/${parseInt(padded, 10)}/${accessionDashless}/${primaryDoc}`,
      accessionNumber: accession,
    });

    if (options.max && out.length >= options.max) break;
  }

  return out;
}

/**
 * EDGAR full-text search. Used by the IPO agent to find fresh S-1/F-1 filings
 * in the last N days regardless of whether the issuer is in the universe.
 *
 * EFTS serves 10 hits per response — this PAGES through with the `from`
 * offset until `max` (default 100) is collected or the result set is
 * exhausted. The v1 audit finding was exactly this: only the first page was
 * ever read, so a busy filing week silently lost most of its S-1s.
 */
const EFTS_PAGE_SIZE = 10;

export async function searchFilings(params: {
  query?: string;
  forms?: string[]; // e.g. ["S-1", "F-1"]
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  max?: number;
}): Promise<RawFiling[]> {
  const max = params.max ?? 100;
  const out: RawFiling[] = [];

  for (let from = 0; out.length < max; from += EFTS_PAGE_SIZE) {
    const qs = new URLSearchParams();
    if (params.query) qs.set("q", `"${params.query}"`);
    if (params.forms?.length) qs.set("forms", params.forms.join(","));
    if (params.dateFrom) qs.set("dateRange", "custom");
    if (params.dateFrom) qs.set("startdt", params.dateFrom);
    if (params.dateTo) qs.set("enddt", params.dateTo);
    if (from > 0) qs.set("from", String(from));

    const url = `${EFTS_BASE}/LATEST/search-index?${qs.toString()}`;
    const data = await httpJson<EdgarFullTextResponse>(url, {
      userAgent: userAgent(),
      hostThrottleMs: HOST_THROTTLE_MS,
      // EDGAR intermittently 403s well-formed requests; retry through it.
      retryStatuses: [403],
    });

    const hits = data.hits.hits;
    for (const hit of hits) {
      if (out.length >= max) break;
      const s = hit._source;
      const accession = s.adsh;
      const accessionDashless = accession.replace(/-/g, "");
      const cik = s.ciks[0];
      out.push({
        issuerName: s.display_names[0],
        issuerCik: cik?.padStart(10, "0"),
        source: "sec_edgar",
        filingType: s.form,
        filedAt: `${s.file_date}T00:00:00Z`,
        url: `${HOST_BASE}/Archives/edgar/data/${parseInt(cik, 10)}/${accessionDashless}/${accession}-index.htm`,
        accessionNumber: accession,
      } satisfies RawFiling);
    }

    // Last page: fewer hits than a full page, or we've seen the whole set.
    if (hits.length < EFTS_PAGE_SIZE) break;
    if (from + EFTS_PAGE_SIZE >= data.hits.total.value) break;
  }

  return out;
}

/**
 * Fetch the raw primary document for a filing. HTML for S-1s and 10-Ks. The
 * IPO agent extracts sections from this in PR 5 using a sectioniser, not here
 * — adapter stays dumb about content semantics.
 */
export async function fetchFilingPrimaryDocument(
  filing: Pick<RawFiling, "url">,
): Promise<string> {
  return httpText(filing.url, {
    userAgent: userAgent(),
    hostThrottleMs: HOST_THROTTLE_MS,
    // EDGAR intermittently 403s well-formed requests; retry through it.
    retryStatuses: [403],
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
}

/**
 * HTML → sections splitter for 10-K/20-F style filings AND S-1/F-1
 * prospectuses.
 *
 * Two v1 audit findings fixed here:
 *  1. The Item regex required "Item N." with a bare number — "Item 1A."
 *     (Risk Factors, the section that matters most) never matched.
 *  2. S-1 prospectuses have NO Item headings at all; they use standalone
 *     uppercase headings ("RISK FACTORS", "USE OF PROCEEDS", …). Without a
 *     fallback the whole prospectus collapsed into "prologue" and an IPO
 *     agent would have scored cover pages.
 *
 * Both modes dedupe table-of-contents echoes: a heading appears in the TOC
 * and again in the body — the occurrence with the LONGER following content
 * wins (the TOC copy is followed by the next TOC line almost immediately).
 */
const PROSPECTUS_HEADINGS = [
  "PROSPECTUS SUMMARY",
  "RISK FACTORS",
  "USE OF PROCEEDS",
  "DIVIDEND POLICY",
  "CAPITALIZATION",
  "DILUTION",
  "MANAGEMENT'S DISCUSSION AND ANALYSIS",
  "BUSINESS",
  "MANAGEMENT",
  "EXECUTIVE COMPENSATION",
  "PRINCIPAL STOCKHOLDERS",
  "PRINCIPAL SHAREHOLDERS",
  "DESCRIPTION OF CAPITAL STOCK",
  "SHARES ELIGIBLE FOR FUTURE SALE",
  "UNDERWRITING",
  "LEGAL MATTERS",
] as const;

export function splitFilingSections(
  accessionNumber: string,
  html: string,
): RawFilingSection[] {
  // Strip HTML tags, normalise whitespace.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const itemSections = splitByHeadings(
    accessionNumber,
    text,
    // "Item 1.", "ITEM 1A.", "Item 7A:", "Item 1A —" — number + optional
    // letter suffix, then a separator.
    [...text.matchAll(/\b(?:ITEM|Item)\s+(\d{1,2}[A-Za-z]?)\s*[.:—–-]\s*/g)].map(
      (m) => ({
        name: `item_${m[1].toLowerCase()}`,
        index: m.index ?? 0,
        headerLength: m[0].length,
      }),
    ),
  );
  if (itemSections.filter((s) => s.sectionName !== "prologue").length >= 2) {
    return itemSections;
  }

  // Prospectus fallback: standalone uppercase headings from the S-1 canon.
  const headingMatches: Array<{ name: string; index: number; headerLength: number }> =
    [];
  for (const heading of PROSPECTUS_HEADINGS) {
    const re = new RegExp(
      `(?<![A-Za-z])${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`,
      "g",
    );
    for (const m of text.matchAll(re)) {
      headingMatches.push({
        name: heading.toLowerCase().replace(/[^a-z]+/g, "_").replace(/_+$/, ""),
        index: m.index ?? 0,
        headerLength: m[0].length,
      });
    }
  }
  headingMatches.sort((a, b) => a.index - b.index);
  return splitByHeadings(accessionNumber, text, headingMatches);
}

/** Build sections from heading positions; duplicate names keep the longer body. */
function splitByHeadings(
  accessionNumber: string,
  text: string,
  headings: Array<{ name: string; index: number; headerLength: number }>,
): RawFilingSection[] {
  const sections: RawFilingSection[] = [];
  const firstIndex = headings.length ? headings[0].index : text.length;
  const prologue = text.slice(0, firstIndex).trim();
  if (prologue.length) {
    sections.push({
      accessionNumber,
      sectionName: "prologue",
      content: prologue.slice(0, 50_000),
    });
  }

  const bestByName = new Map<string, string>();
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
    const body = text.slice(h.index + h.headerLength, end).trim();
    if (!body.length) continue;
    const existing = bestByName.get(h.name);
    // TOC echoes are near-empty (the next heading follows immediately) —
    // the real section body is longer and wins.
    if (existing === undefined || body.length > existing.length) {
      bestByName.set(h.name, body);
    }
  }

  for (const [sectionName, content] of bestByName) {
    sections.push({
      accessionNumber,
      sectionName,
      content: content.slice(0, 80_000),
    });
  }
  return sections;
}

export const capabilities: AdapterCapabilities = {
  name: "sec_edgar",
  paid: false,
  readinessCheck: () =>
    process.env.SEC_EDGAR_USER_AGENT ? null : "SEC_EDGAR_USER_AGENT not set",
  provides: ["filings"],
};
