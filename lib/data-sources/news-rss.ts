import { httpText } from "./http";
import type { AdapterCapabilities, RawNewsArticle } from "./types";

/**
 * Free RSS news adapter.
 *
 * v1 source list — leaning on outlets with stable, well-formed RSS:
 *   - Reuters Business: https://feeds.reuters.com/reuters/businessNews (legacy)
 *   - Financial Times Companies: https://www.ft.com/companies?format=rss
 *   - SeekingAlpha market-currents: https://seekingalpha.com/market_currents.xml
 *   - Yahoo Finance topstories: https://finance.yahoo.com/news/rssindex
 *   - MarketWatch top: https://feeds.marketwatch.com/marketwatch/topstories/
 *
 * Sentiment scoring and entity tagging are deferred to the news ingest layer
 * (lib/ingest/ingest-news.ts) — the adapter only normalises feed items.
 *
 * Paid alternative (PR-2-ready, scaffolded in marketaux.ts): Marketaux gives
 * proper entity tagging, sentiment and licence to redistribute.
 */

const HOST_THROTTLE_MS = 1_000;

export interface RssFeedConfig {
  source: string;
  url: string;
}

export const FEEDS: RssFeedConfig[] = [
  { source: "yahoo_finance", url: "https://finance.yahoo.com/news/rssindex" },
  { source: "marketwatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { source: "seekingalpha", url: "https://seekingalpha.com/market_currents.xml" },
  { source: "ft_companies", url: "https://www.ft.com/companies?format=rss" },
];

export async function fetchFeed(config: RssFeedConfig): Promise<RawNewsArticle[]> {
  const xml = await httpText(config.url, {
    hostThrottleMs: HOST_THROTTLE_MS,
    headers: { Accept: "application/rss+xml,application/xml,text/xml" },
  });
  return parseFeed(xml, config.source);
}

export async function fetchAllFeeds(): Promise<RawNewsArticle[]> {
  const results: RawNewsArticle[] = [];
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      results.push(...items);
    } catch {
      // Individual feed failures are non-fatal — log upstream, continue.
    }
  }
  return results;
}

function parseFeed(xml: string, source: string): RawNewsArticle[] {
  const items: RawNewsArticle[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extract(block, "title");
    const link = extract(block, "link");
    const pubDate = extract(block, "pubDate") ?? extract(block, "dc:date");
    const description = extract(block, "description");
    if (!title || !link || !pubDate) continue;
    const ts = new Date(pubDate);
    if (Number.isNaN(ts.getTime())) continue;
    items.push({
      source,
      url: link,
      title: stripHtml(title),
      summary: description ? stripHtml(description).slice(0, 2_000) : undefined,
      publishedAt: ts.toISOString(),
    });
  }
  return items;
}

function extract(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`).exec(
    block,
  );
  return m?.[1]?.trim() ?? null;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export const capabilities: AdapterCapabilities = {
  name: "news_rss",
  paid: false,
  readinessCheck: () => null,
  provides: ["news"],
};
