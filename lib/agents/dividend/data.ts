import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getErrorMessage } from "@/lib/errors";

/**
 * Batch data loader for the dividend agent. ONE query per table for the
 * whole candidate set — the resolver must never issue per-candidate
 * round-trips (3.5c's batch-resolver requirement, honoured from day one).
 */

export interface SecurityRow {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  currency: string;
}

export interface DividendRow {
  id: string;
  security_id: string;
  ex_date: string;
  amount: number;
  currency: string;
}

export interface PriceRow {
  security_id: string;
  snapshot_date: string;
  close: number;
  currency: string | null;
}

export interface FinancialsRow {
  id: string;
  security_id: string;
  period_end: string;
  period_type: string;
  net_income: number | null;
  ebitda: number | null;
  total_debt: number | null;
  operating_cash_flow: number | null;
  free_cash_flow: number | null;
  dividends_paid: number | null;
  market_cap: number | null;
  shares_outstanding: number | null;
  source: string;
}

export interface DividendDataset {
  securities: Map<string, SecurityRow>;
  /** Per security, ex-date ascending. */
  dividends: Map<string, DividendRow[]>;
  /** Per security, snapshot-date ascending (daily closes, trailing ~25 months). */
  prices: Map<string, PriceRow[]>;
  /** Per security, period_end DESCENDING (newest first), max 3 rows. */
  financials: Map<string, FinancialsRow[]>;
  asOf: string; // YYYY-MM-DD
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function loadDividendDataset(
  securityIds: string[],
): Promise<DividendDataset> {
  const supabase = createServiceClient();
  const asOf = new Date().toISOString().slice(0, 10);

  // All reads paginate through fetchAllRows — the daily-price query alone
  // exceeds PostgREST's 1,000-row cap and would otherwise silently truncate.
  const [securityRows, dividendRows, priceRows, financialsRows] =
    await Promise.all([
      fetchAllRows<SecurityRow>(
        (from, to) =>
          supabase
            .from("securities")
            .select("id, ticker, exchange, name, sector, currency")
            .in("id", securityIds)
            .order("id", { ascending: true })
            .range(from, to),
        "dividend securities",
      ),
      fetchAllRows<DividendRow>(
        (from, to) =>
          supabase
            .from("dividends")
            .select("id, security_id, ex_date, amount, currency")
            .in("security_id", securityIds)
            .gte("ex_date", daysAgoIso(6 * 365))
            .order("security_id", { ascending: true })
            .order("ex_date", { ascending: true })
            .range(from, to),
        "dividend history",
      ),
      fetchAllRows<PriceRow>(
        (from, to) =>
          supabase
            .from("price_snapshots")
            .select("security_id, snapshot_date, close, currency")
            .in("security_id", securityIds)
            .gte("snapshot_date", daysAgoIso(760))
            .order("security_id", { ascending: true })
            .order("snapshot_date", { ascending: true })
            .range(from, to),
        "dividend prices",
      ),
      fetchAllRows<FinancialsRow>(
        (from, to) =>
          supabase
            .from("financials_snapshot")
            .select(
              "id, security_id, period_end, period_type, net_income, ebitda, total_debt, operating_cash_flow, free_cash_flow, dividends_paid, market_cap, shares_outstanding, source",
            )
            .in("security_id", securityIds)
            .order("security_id", { ascending: true })
            .order("period_end", { ascending: false })
            .range(from, to),
        "dividend financials",
      ),
    ]).catch((err) => {
      throw new Error(`loadDividendDataset: ${getErrorMessage(err)}`);
    });

  const securities = new Map<string, SecurityRow>();
  for (const s of securityRows) securities.set(s.id, s);

  const dividends = groupBy(dividendRows, (r) => r.security_id);
  const prices = groupBy(priceRows, (r) => r.security_id);

  const financials = new Map<string, FinancialsRow[]>();
  for (const row of financialsRows) {
    const arr = financials.get(row.security_id) ?? [];
    if (arr.length < 3) arr.push(row); // newest-first, capped
    financials.set(row.security_id, arr);
  }

  return { securities, dividends, prices, financials, asOf };
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const arr = out.get(key);
    if (arr) arr.push(row);
    else out.set(key, [row]);
  }
  return out;
}
