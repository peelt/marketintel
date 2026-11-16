import type { IndexConstituent } from "@/lib/data-sources/index-constituents";

/**
 * Plan a broad-universe refresh against the live index constituents. Pure —
 * the I/O lives in seed-broad-universe.ts.
 *
 * The universe used to be seeded once and only ever ADDED to. Index
 * membership changes every quarter (and S&P makes ad-hoc changes between), so
 * within three months it had drifted by 34 names: 17 promoted into the S&P 500
 * / FTSE 350 that the desk never screened, and 17 relegated ones it still did.
 * This plan makes membership track the index in both directions.
 *
 * Pruning removes only the INDEX tags. The security row stays — report
 * history, verdict outcomes and any holding still reference it — and any
 * non-index tags (curated watchlists) are kept.
 */

/** Tags this process owns; everything else on a row is left alone. */
export const INDEX_TAGS = ["broad_market", "sp500", "ftse100", "ftse250"] as const;
const OWNED = new Set<string>(INDEX_TAGS);

/**
 * Above this share of the current universe, a prune is refused. A real
 * quarterly review moves a few percent; anything near this means the source
 * changed shape or returned a partial list, and pruning on it would quietly
 * gut the screen.
 */
export const MAX_PRUNE_SHARE = 0.1;

export interface ExistingSecurity {
  id: string;
  ticker: string;
  exchange: string;
  tags: string[] | null;
}

export interface UniversePlan {
  /** Existing rows whose tags change (retagged members AND pruned leavers). */
  updates: { id: string; ticker: string; tags: string[] }[];
  /** Constituents with no matching row yet. */
  inserts: IndexConstituent[];
  /** Tickers leaving the universe this run (subset of `updates`). */
  pruned: string[];
  /** True when the prune was refused by the safety cap. */
  pruneRefused: boolean;
}

const US = new Set(["US", "NYSE", "NASDAQ", "AMEX"]);
const UK = new Set(["LSE", "LON"]);

/** NYSE/NASDAQ/"US" are one market for matching; so are LSE/LON. */
export function exchangeClass(exchange: string): string {
  const e = exchange.toUpperCase();
  if (US.has(e)) return "US";
  if (UK.has(e)) return "LSE";
  return e;
}

const key = (ticker: string, exchange: string) =>
  `${ticker.toUpperCase()}|${exchangeClass(exchange)}`;

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function planUniverseRefresh(
  existing: ExistingSecurity[],
  live: IndexConstituent[],
): UniversePlan {
  // A name can sit in more than one list (dedupe keeps the first); collect
  // every index it belongs to so the tags are complete.
  const liveIndexes = new Map<string, Set<string>>();
  const liveByKey = new Map<string, IndexConstituent>();
  for (const c of live) {
    const k = key(c.ticker, c.exchange);
    if (!liveByKey.has(k)) liveByKey.set(k, c);
    const s = liveIndexes.get(k) ?? new Set<string>();
    s.add(c.index);
    liveIndexes.set(k, s);
  }

  const updates: UniversePlan["updates"] = [];
  const pruneCandidates: UniversePlan["updates"] = [];
  const matched = new Set<string>();

  // Group rows by market identity first. Some companies have TWO rows — the
  // retired geopolitical desk seeded its own NASDAQ/NYSE rows three days after
  // the S&P seed created "US" ones (NVDA, AAPL, AMD, TSLA and 14 more). Only
  // one row per company may be the member, or the desk screens it twice.
  const groups = new Map<string, ExistingSecurity[]>();
  for (const row of existing) {
    const k = key(row.ticker, row.exchange);
    const g = groups.get(k) ?? [];
    g.push(row);
    groups.set(k, g);
  }

  for (const [k, rows] of groups) {
    const isLive = liveByKey.has(k);
    // The incumbent — the row already carrying broad_market — keeps the
    // membership, so a refresh never moves a company onto a different row
    // and splits its price and verdict history.
    const member = isLive
      ? (rows.find((r) => (r.tags ?? []).includes("broad_market")) ?? rows[0])
      : null;

    for (const row of rows) {
      const current = row.tags ?? [];
      const kept = current.filter((t) => !OWNED.has(t));
      if (row === member) {
        matched.add(k);
        const next = [...kept, "broad_market", ...[...liveIndexes.get(k)!].sort()];
        if (!sameSet(current, next)) {
          updates.push({ id: row.id, ticker: row.ticker, tags: next });
        }
      } else if (current.includes("broad_market")) {
        if (isLive) {
          // A second row for a company that IS still a member: strip it so
          // the company is screened once. Not a leaver, so not counted.
          updates.push({ id: row.id, ticker: row.ticker, tags: kept });
        } else {
          pruneCandidates.push({ id: row.id, ticker: row.ticker, tags: kept });
        }
      }
    }
  }

  const inserts = [...liveByKey.entries()]
    .filter(([k]) => !matched.has(k))
    .map(([, c]) => c);

  const currentSize = existing.filter((r) => (r.tags ?? []).includes("broad_market")).length;
  const pruneRefused =
    currentSize > 0 && pruneCandidates.length / currentSize > MAX_PRUNE_SHARE;

  return {
    updates: pruneRefused ? updates : [...updates, ...pruneCandidates],
    inserts,
    pruned: pruneRefused ? [] : pruneCandidates.map((p) => p.ticker),
    pruneRefused,
  };
}
