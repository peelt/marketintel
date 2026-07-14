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
 */
export async function searchFilings(params: {
  query?: string;
  forms?: string[]; // e.g. ["S-1", "F-1"]
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  max?: number;
}): Promise<RawFiling[]> {
  const qs = new URLSearchParams();
  if (params.query) qs.set("q", `"${params.query}"`);
  if (params.forms?.length) qs.set("forms", params.forms.join(","));
  if (params.dateFrom) qs.set("dateRange", "custom");
  if (params.dateFrom) qs.set("startdt", params.dateFrom);
  if (params.dateTo) qs.set("enddt", params.dateTo);

  const url = `${EFTS_BASE}/LATEST/search-index?${qs.toString()}`;
  const data = await httpJson<EdgarFullTextResponse>(url, {
    userAgent: userAgent(),
    hostThrottleMs: HOST_THROTTLE_MS,
    // EDGAR intermittently 403s well-formed requests; retry through it.
    retryStatuses: [403],
  });

  return data.hits.hits.slice(0, params.max ?? 100).map((hit) => {
    const s = hit._source;
    const accession = s.adsh;
    const accessionDashless = accession.replace(/-/g, "");
    const cik = s.ciks[0];
    return {
      issuerName: s.display_names[0],
      issuerCik: cik?.padStart(10, "0"),
      source: "sec_edgar",
      filingType: s.form,
      filedAt: `${s.file_date}T00:00:00Z`,
      url: `${HOST_BASE}/Archives/edgar/data/${parseInt(cik, 10)}/${accessionDashless}/${accession}-index.htm`,
      accessionNumber: accession,
    } satisfies RawFiling;
  });
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
 * Crude HTML → sections splitter. Returns the top-level Item N divisions found
 * in 10-K and S-1 documents. Good enough for v1; PR 5 may swap for something
 * smarter (e.g. an embedding-based section detector).
 */
export function splitFilingSections(
  accessionNumber: string,
  html: string,
): RawFilingSection[] {
  // Strip HTML tags, normalise whitespace.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

  // Heuristic: split on "Item N." or "ITEM N." up to two-digit item numbers.
  const pieces = text.split(/\b(ITEM|Item)\s+(\d{1,2})\.\s+/);
  const sections: RawFilingSection[] = [];

  // First chunk before any Item is the prologue.
  if (pieces[0]?.trim().length) {
    sections.push({
      accessionNumber,
      sectionName: "prologue",
      content: pieces[0].slice(0, 50_000),
    });
  }

  for (let i = 1; i < pieces.length; i += 3) {
    const itemNumber = pieces[i + 1];
    const body = pieces[i + 2] ?? "";
    if (!itemNumber || !body.trim().length) continue;
    sections.push({
      accessionNumber,
      sectionName: `item_${itemNumber}`,
      content: body.slice(0, 80_000),
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
