/**
 * Live ticker search for "analyse a drop" — pure, unit-tested ranking over
 * the Reaction universe.
 *
 * The universe is small (~850 names, ~9KB gzipped as tuples), so the form
 * fetches it once and ranks in the browser on every keystroke: instant, no
 * debounce, no per-character round-trip, no stale-response race. This module
 * is the part that matters — what "voda" should offer — and it lives in lib/
 * so it can be tested without a DOM.
 *
 * Rank order (strongest first): exact ticker → ticker prefix → name starts a
 * word with the query → name contains the query. Ties break on ticker. A
 * trailing ".L" in the query (the London convention the placeholder itself
 * uses) is stripped and prefers LSE rows — tickers are stored WITHOUT it.
 */

export interface SearchableSecurity {
  id: string;
  ticker: string;
  exchange: string;
  name: string | null;
}

export interface NormalisedQuery {
  /** Uppercased, trimmed, punctuation stripped, ".L" removed. */
  term: string;
  /** The query carried a ".L" suffix → the user means the London line. */
  preferLse: boolean;
}

export function normaliseQuery(raw: string): NormalisedQuery {
  let term = raw.trim().toUpperCase().replace(/[%,()]/g, " ").trim();
  let preferLse = false;
  if (/\.L$/.test(term)) {
    term = term.slice(0, -2).trim();
    preferLse = true;
  }
  return { term, preferLse };
}

type Tier = 0 | 1 | 2 | 3;

function tierOf(term: string, s: SearchableSecurity): Tier | null {
  const ticker = s.ticker.toUpperCase();
  if (ticker === term) return 0;
  if (ticker.startsWith(term)) return 1;
  const name = (s.name ?? "").toUpperCase();
  if (!name) return null;
  if (name.startsWith(term)) return 2;
  // A word boundary inside the name ("ADVANCED MICRO" for "micro") also counts
  // as a strong name match; a mid-word hit is the weakest tier.
  if (new RegExp(`[\\s\\-/&.(]${escapeRegex(term)}`).test(name)) return 2;
  if (name.includes(term)) return 3;
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The best `limit` matches for a query, strongest first. Empty query → [].
 * Pure; the form calls this on every keystroke.
 */
export function rankSecurityMatches(
  raw: string,
  universe: readonly SearchableSecurity[],
  limit = 8,
): SearchableSecurity[] {
  const { term, preferLse } = normaliseQuery(raw);
  if (!term) return [];

  const scored: { s: SearchableSecurity; tier: Tier; lse: 0 | 1 }[] = [];
  for (const s of universe) {
    const tier = tierOf(term, s);
    if (tier === null) continue;
    scored.push({ s, tier, lse: preferLse && s.exchange === "LSE" ? 0 : 1 });
  }
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.lse !== b.lse) return a.lse - b.lse;
    // Ticker tiers: the shorter ticker is the closer match. Name tiers: the
    // reader is scanning names, so order by name.
    if (a.tier <= 1) {
      if (a.s.ticker.length !== b.s.ticker.length) {
        return a.s.ticker.length - b.s.ticker.length;
      }
      return a.s.ticker.localeCompare(b.s.ticker);
    }
    return (a.s.name ?? "").localeCompare(b.s.name ?? "") ||
      a.s.ticker.localeCompare(b.s.ticker);
  });
  return scored.slice(0, limit).map((x) => x.s);
}
