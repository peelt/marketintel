import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { SessionRow } from "./metrics";

/**
 * Data loading for the Reaction Analyser.
 *
 * Two tiers, sized deliberately:
 *  - the SCREEN reads ~60 calendar days of closes for the whole broad-market
 *    universe (hundreds of names — always paginated);
 *  - the DEEP set reads a year of prices + latest financials for only the
 *    names that passed the drop screen (a handful to a few dozen).
 */

export interface ReactionSecurity {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  currency: string;
}

export interface ReactionFinancials {
  id: string;
  security_id: string;
  period_end: string;
  total_debt: number | null;
  ebitda: number | null;
  free_cash_flow: number | null;
  market_cap: number | null;
  source: string;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Broad-market securities (tagged by seed-broad-universe). */
export async function loadBroadUniverse(): Promise<ReactionSecurity[]> {
  const supabase = createServiceClient();
  return fetchAllRows<ReactionSecurity>(
    (from, to) =>
      supabase
        .from("securities")
        .select("id, ticker, exchange, name, sector, currency")
        .contains("tags", ["broad_market"])
        .is("delisted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    "reaction broad universe",
  );
}

/**
 * Recent close/volume series for a set of securities. Paginated — at screen
 * scale this is tens of thousands of rows.
 */
export async function loadRecentSeries(
  securityIds: string[],
  lookbackDays: number,
): Promise<Map<string, SessionRow[]>> {
  const supabase = createServiceClient();
  const out = new Map<string, SessionRow[]>();

  // .in() with hundreds of UUIDs blows up the querystring — chunk the id
  // list and paginate within each chunk.
  for (let i = 0; i < securityIds.length; i += 100) {
    const idChunk = securityIds.slice(i, i + 100);
    const rows = await fetchAllRows<{
      security_id: string;
      snapshot_date: string;
      close: number;
      volume: number | null;
    }>(
      (from, to) =>
        supabase
          .from("price_snapshots")
          .select("security_id, snapshot_date, close, volume")
          .in("security_id", idChunk)
          .gte("snapshot_date", daysAgoIso(lookbackDays))
          .order("security_id", { ascending: true })
          .order("snapshot_date", { ascending: true })
          .range(from, to),
      `reaction series (${lookbackDays}d)`,
    );
    for (const row of rows) {
      const arr = out.get(row.security_id) ?? [];
      arr.push({ date: row.snapshot_date, close: row.close, volume: row.volume });
      out.set(row.security_id, arr);
    }
  }
  return out;
}

/** Latest financials snapshot per screened security (small set). */
export async function loadLatestFinancials(
  securityIds: string[],
): Promise<Map<string, ReactionFinancials>> {
  const supabase = createServiceClient();
  const rows = await fetchAllRows<ReactionFinancials>(
    (from, to) =>
      supabase
        .from("financials_snapshot")
        .select("id, security_id, period_end, total_debt, ebitda, free_cash_flow, market_cap, source")
        .in("security_id", securityIds)
        .order("security_id", { ascending: true })
        .order("period_end", { ascending: false })
        .range(from, to),
    "reaction financials",
  );
  const out = new Map<string, ReactionFinancials>();
  for (const row of rows) {
    if (!out.has(row.security_id)) out.set(row.security_id, row);
  }
  return out;
}
