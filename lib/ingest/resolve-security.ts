import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";

/**
 * Resolve security UUIDs by (ticker, exchange).
 *
 * 3.5c semantics:
 *  - BULK lookup: one query for any number of pairs (Reaction's ~800-name
 *    universe must not mean 800 round-trips).
 *  - NEGATIVE caching: an untracked ticker is remembered as absent for a TTL
 *    so repeated ingest passes don't re-query it every time. Positive hits
 *    cache indefinitely — UUIDs are stable.
 */

const NEGATIVE_TTL_MS = 10 * 60_000;

interface CacheEntry {
  id: string | null;
  /** Only meaningful for negative entries; positives never expire. */
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function keyOf(ticker: string, exchange: string): string {
  return `${ticker}::${exchange}`;
}

function cachedLookup(key: string, now: number): CacheEntry | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.id === null && hit.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return hit;
}

/**
 * Match DB rows back to requested pairs. Exported for tests — the bulk query
 * fetches by ticker only (tuple-IN isn't expressible through the client), so
 * exchange matching happens here.
 */
export function matchPairs(
  rows: { id: string; ticker: string; exchange: string }[],
  pairs: { ticker: string; exchange: string }[],
): Map<string, string | null> {
  const byKey = new Map<string, string>();
  for (const row of rows) byKey.set(keyOf(row.ticker, row.exchange), row.id);
  const out = new Map<string, string | null>();
  for (const pair of pairs) {
    const key = keyOf(pair.ticker, pair.exchange);
    out.set(key, byKey.get(key) ?? null);
  }
  return out;
}

/**
 * Bulk resolve. Returns a map keyed `ticker::exchange` → uuid | null.
 * Unknown pairs come back null (and are negatively cached).
 */
export async function resolveSecurityIds(
  pairs: { ticker: string; exchange: string }[],
): Promise<Map<string, string | null>> {
  const now = Date.now();
  const out = new Map<string, string | null>();
  const misses: { ticker: string; exchange: string }[] = [];
  const seen = new Set<string>();

  for (const pair of pairs) {
    const key = keyOf(pair.ticker, pair.exchange);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = cachedLookup(key, now);
    if (hit) out.set(key, hit.id);
    else misses.push(pair);
  }
  if (misses.length === 0) return out;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("securities")
    .select("id, ticker, exchange")
    .in("ticker", [...new Set(misses.map((p) => p.ticker))])
    .returns<{ id: string; ticker: string; exchange: string }[]>();
  if (error) {
    throw new Error(`resolveSecurityIds: ${getErrorMessage(error)}`);
  }

  const matched = matchPairs(data ?? [], misses);
  for (const [key, id] of matched) {
    out.set(key, id);
    cache.set(key, {
      id,
      expiresAt: id === null ? now + NEGATIVE_TTL_MS : Number.POSITIVE_INFINITY,
    });
  }
  return out;
}

/** Single-pair convenience — same cache, same semantics. */
export async function resolveSecurityId(
  ticker: string,
  exchange: string,
): Promise<string | null> {
  const resolved = await resolveSecurityIds([{ ticker, exchange }]);
  return resolved.get(keyOf(ticker, exchange)) ?? null;
}

export function clearSecurityCache() {
  cache.clear();
}
