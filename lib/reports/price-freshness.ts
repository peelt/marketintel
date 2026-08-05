import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getErrorMessage } from "@/lib/errors";

/**
 * Per-market price freshness — is the desk screening today's closes, or
 * yesterday's?
 *
 * The live case this exists to measure: AZN fell 8.96% on 3 Aug, but its 3 Aug
 * close hadn't landed when that evening's run fired, so it was screened a day
 * late in the 4 Aug edition. A one-day lag sails straight through the 10-day
 * staleness gate. If LSE prints land systematically later than US ones, every
 * UK drop files a day late — which would matter more than any framework tweak,
 * since UK coverage is the product's moat.
 */

const WINDOW_DAYS = 6;

export interface MarketFreshness {
  market: string;
  /** Securities with at least one print in the window. */
  tracked: number;
  /** The newest print date seen anywhere in this market. */
  latestPrint: string | null;
  /** Securities whose newest print IS the market's latest date. */
  current: number;
  /** Securities one trading print behind the market's latest. */
  oneBehind: number;
  /** Securities two or more prints behind. */
  staler: number;
}

export interface PriceFreshness {
  markets: MarketFreshness[];
  /** Distinct print dates seen in the window, newest first. */
  recentDates: string[];
}

interface SnapshotRow {
  security_id: string;
  snapshot_date: string;
  security: { exchange: string } | null;
}

/**
 * Reduce raw snapshot rows to the per-market summary. Pure — unit-tested.
 * "Behind" is measured in PRINT DATES observed for that market (not calendar
 * days), so a weekend or holiday never reads as staleness.
 */
export function summariseFreshness(rows: SnapshotRow[]): PriceFreshness {
  const byMarket = new Map<string, Map<string, string>>(); // market -> secId -> latest date
  const allDates = new Set<string>();
  for (const r of rows) {
    const market = r.security?.exchange ?? "unknown";
    allDates.add(r.snapshot_date);
    const m = byMarket.get(market) ?? new Map<string, string>();
    const prev = m.get(r.security_id);
    if (!prev || r.snapshot_date > prev) m.set(r.security_id, r.snapshot_date);
    byMarket.set(market, m);
  }

  const markets: MarketFreshness[] = [...byMarket.entries()]
    .map(([market, latestBySecurity]) => {
      // The market's own print calendar — LSE and US differ on holidays.
      const marketDates = [...new Set([...latestBySecurity.values()])].sort().reverse();
      const latestPrint = marketDates[0] ?? null;
      const second = marketDates[1] ?? null;
      let current = 0;
      let oneBehind = 0;
      let staler = 0;
      for (const d of latestBySecurity.values()) {
        if (d === latestPrint) current++;
        else if (second !== null && d === second) oneBehind++;
        else staler++;
      }
      return {
        market,
        tracked: latestBySecurity.size,
        latestPrint,
        current,
        oneBehind,
        staler,
      };
    })
    .sort((a, b) => b.tracked - a.tracked);

  return {
    markets,
    recentDates: [...allDates].sort().reverse().slice(0, WINDOW_DAYS),
  };
}

export async function loadPriceFreshness(
  supabase: SupabaseClient,
  now: number = Date.now(),
): Promise<PriceFreshness> {
  const sinceIso = new Date(now - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  try {
    const rows = await fetchAllRows<SnapshotRow>(
      (from, to) =>
        supabase
          .from("price_snapshots")
          .select("security_id, snapshot_date, security:securities!inner(exchange)")
          .gte("snapshot_date", sinceIso)
          .order("security_id", { ascending: true })
          .range(from, to)
          .returns<SnapshotRow[]>(),
      "price freshness",
    );
    return summariseFreshness(rows);
  } catch (err) {
    console.error(`loadPriceFreshness: ${getErrorMessage(err)}`);
    return { markets: [], recentDates: [] };
  }
}
