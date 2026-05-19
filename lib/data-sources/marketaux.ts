import type { AdapterCapabilities, RawNewsArticle } from "./types";

/**
 * Marketaux (paid). NOT ACTIVE IN V1.
 *
 * Financial news with proper entity tagging, sentiment scoring, and licence
 * to redistribute (relevant if the tool ever flips to multi-user).
 *
 * Reference: https://www.marketaux.com/documentation
 */

function notActive(): never {
  throw new Error(
    "Marketaux adapter is not active in v1. Set MARKETAUX_API_KEY and implement these methods when promoting to paid tier.",
  );
}

export async function fetchNews(_params: {
  tickers?: string[];
  topics?: string[];
  publishedAfter?: string;
  limit?: number;
}): Promise<RawNewsArticle[]> {
  notActive();
}

export const capabilities: AdapterCapabilities = {
  name: "marketaux",
  paid: true,
  readinessCheck: () =>
    process.env.MARKETAUX_API_KEY ? null : "Marketaux adapter stubbed; set MARKETAUX_API_KEY to activate",
  provides: ["news"],
};
