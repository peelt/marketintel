import { httpText } from "./http";
import type { AdapterCapabilities, RawFiling } from "./types";

/**
 * LSE RNS announcements.
 *
 * LSE itself doesn't publish a free public feed. Investegate aggregates the
 * RNS stream and exposes per-company RSS at predictable URLs:
 *   https://www.investegate.co.uk/Rss.aspx?ticker={TICKER}
 *
 * Returns regulatory news items (results, trading updates, IPO admission
 * documents). Used by the IPO agent (PR 5) for UK listings and the Dividend
 * agent (PR 4) to pick up dividend declarations early.
 *
 * Note: scraping aggregator RSS is a soft dependency. If Investegate changes
 * its feed format, swap the parser without touching the consumer side.
 */

const HOST_THROTTLE_MS = 500;

export async function fetchCompanyAnnouncements(params: {
  ticker: string;
  /** Limit to items newer than this ISO date. */
  since?: string;
}): Promise<RawFiling[]> {
  const url = `https://www.investegate.co.uk/Rss.aspx?ticker=${encodeURIComponent(params.ticker)}`;
  const xml = await httpText(url, {
    hostThrottleMs: HOST_THROTTLE_MS,
    headers: { Accept: "application/rss+xml,text/xml" },
  });

  return parseRssItems(xml, params.ticker, params.since);
}

/**
 * Naive RSS parser — sufficient for the simple RNS feeds we consume. Pulls
 * <item> blocks and extracts title, link, pubDate.
 */
function parseRssItems(xml: string, ticker: string, since?: string): RawFiling[] {
  const items: RawFiling[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const sinceTs = since ? new Date(since).getTime() : 0;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extract(block, "title");
    const link = extract(block, "link");
    const pubDate = extract(block, "pubDate");
    if (!title || !link || !pubDate) continue;

    const filedAt = new Date(pubDate);
    if (Number.isNaN(filedAt.getTime())) continue;
    if (filedAt.getTime() < sinceTs) continue;

    items.push({
      ticker,
      exchange: "LSE",
      source: "lse_rns",
      filingType: classifyAnnouncement(title),
      filedAt: filedAt.toISOString(),
      url: link,
      // RNS items have no EDGAR-style accession number; the announcement URL
      // is the stable per-item identity and serves as the dedupe key.
      accessionNumber: link,
    });
  }

  return items;
}

function classifyAnnouncement(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("admission") || t.includes("prospectus")) return "ADMISSION";
  if (t.includes("dividend")) return "DIVIDEND";
  if (t.includes("trading update") || t.includes("trading statement")) return "TRADING_UPDATE";
  if (t.includes("results")) return "RESULTS";
  if (t.includes("director") && t.includes("dealing")) return "DIRECTOR_DEALING";
  if (t.includes("acquisition") || t.includes("disposal")) return "M_AND_A";
  return "OTHER";
}

function extract(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`).exec(
    block,
  );
  return m?.[1]?.trim() ?? null;
}

export const capabilities: AdapterCapabilities = {
  name: "lse_rns",
  paid: false,
  readinessCheck: () => null,
  provides: ["filings"],
};
