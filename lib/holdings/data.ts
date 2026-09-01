import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getErrorMessage } from "@/lib/errors";

/**
 * How far back to look for a held name's latest verdict. All desks run at
 * least weekly, so ~120 days always contains a recent one; bounding the read
 * (with pagination) is what keeps report_items — which grows one row per name
 * per weekly run forever — from silently tripping PostgREST's 1,000-row cap
 * and dropping the last-sorted names' verdicts.
 */
const VERDICT_LOOKBACK_DAYS = 120;

/**
 * Read model for the My Portfolio surfaces. All reads run under the caller's
 * RLS session (createClient): holdings are user-scoped, prices and report_items
 * are entitled-read. The service-role client must never reach this path.
 *
 * Each held name is decorated with its latest close + prior close (for the day
 * figure) and its most recent desk verdict (classification + coverage) — the
 * seam where the intel lens (6b) plugs in. Purchase price rides along for P/L
 * display only; it is never joined into scoring.
 */

export interface PortfolioRow {
  id: string;
  name: string;
  base_currency: string;
}

export interface HoldingBase {
  id: string;
  security_id: string;
  quantity: number;
  purchase_price: number | null;
  purchase_currency: string | null;
  purchase_date: string | null;
  notes: string | null;
  security: {
    id: string;
    ticker: string;
    exchange: string;
    name: string;
    currency: string;
  } | null;
}

export interface HeldName {
  holdingId: string;
  securityId: string;
  ticker: string;
  exchange: string;
  name: string;
  quantity: number;
  purchasePrice: number | null;
  purchaseCurrency: string | null;
  purchaseDate: string | null;
  notes: string | null;
  latestClose: number | null;
  previousClose: number | null;
  priceCurrency: string | null;
  priceAsOf: string | null;
  // Latest desk verdict for this name (null until a desk has covered it).
  classification: string | null;
  composite: number | null;
  coverage: number | null;
  verdictAgent: string | null;
  verdictReportId: string | null;
  verdictAt: string | null;
}

interface PriceRow {
  security_id: string;
  snapshot_date: string;
  close: number;
  currency: string | null;
}

export interface HeldVerdictRow {
  security_id: string | null;
  classification: string | null;
  composite_score: number;
  scoring_breakdown: { coverage?: number } | null;
  report: {
    id: string;
    agent_name: string;
    generated_at: string;
    agent_runs: { status: string } | null;
  } | null;
}

/**
 * The portfolio's holding rows, resolved ONCE per request.
 *
 * Both /dashboard and /portfolio need these twice per render — the valuation
 * (loadHeldNames) and the intel lens (loadPortfolioIntel) each used to issue
 * their own identical `holdings` query. React's cache() keyed on the same
 * client + portfolio id collapses them into one round-trip.
 */
export const loadHoldingRows = cache(
  async (
    supabase: SupabaseClient,
    portfolioId: string,
  ): Promise<HoldingBase[]> => {
    const { data, error } = await supabase
      .from("holdings")
      .select(
        "id, security_id, quantity, purchase_price, purchase_currency, purchase_date, notes, security:securities(id, ticker, exchange, name, currency)",
      )
      .eq("portfolio_id", portfolioId)
      .order("created_at", { ascending: true })
      .returns<HoldingBase[]>();
    // A read error here must NOT render as an empty portfolio (a user seeing
    // £0 and no holdings would think their positions vanished). Surface it.
    if (error) {
      throw new Error(`loadHoldingRows: ${getErrorMessage(error)}`);
    }
    return data ?? [];
  },
);

/**
 * Recent succeeded verdicts for every held name, over the WIDEST window any
 * caller needs. The valuation wants 120 days and the intel lens 90, and they
 * were paginating the same table separately; fetching the superset once and
 * narrowing in memory makes the second read free.
 *
 * Date-bounded AND paginated: report_items accumulate one row per name per run
 * indefinitely, so an unbounded read silently truncates at 1,000 rows once a
 * portfolio has run long enough, dropping whichever securities sort last.
 * Deterministic total order (security_id, then id) makes pagination safe.
 */
export const loadHeldVerdictRows = cache(
  async (
    supabase: SupabaseClient,
    portfolioId: string,
  ): Promise<HeldVerdictRow[]> => {
    const rows = await loadHoldingRows(supabase, portfolioId);
    const securityIds = [...new Set(rows.map((h) => h.security_id))];
    if (securityIds.length === 0) return [];

    const sinceIso = new Date(
      Date.now() - VERDICT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    return fetchAllRows<HeldVerdictRow>(
      (from, to) =>
        supabase
          .from("report_items")
          .select(
            "id, security_id, classification, composite_score, scoring_breakdown, report:reports!inner(id, agent_name, generated_at, agent_runs!inner(status))",
          )
          .in("security_id", securityIds)
          .eq("report.agent_runs.status", "succeeded")
          .gte("report.generated_at", sinceIso)
          .order("security_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
          .returns<HeldVerdictRow[]>(),
      "held verdicts",
    );
  },
);

/** The user's default portfolio, if one exists yet. */
export async function loadDefaultPortfolio(
  supabase: SupabaseClient,
  userId: string,
): Promise<PortfolioRow | null> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name, base_currency")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<PortfolioRow>();
  // Don't let a read error masquerade as "no portfolio yet" silently.
  if (error) {
    throw new Error(`loadDefaultPortfolio: ${getErrorMessage(error)}`);
  }
  return data ?? null;
}

export async function loadHeldNames(
  supabase: SupabaseClient,
  portfolioId: string,
): Promise<HeldName[]> {
  const rows = await loadHoldingRows(supabase, portfolioId);
  if (rows.length === 0) return [];

  const securityIds = [...new Set(rows.map((h) => h.security_id))];

  // Recent closes for the held names (last ~10 sessions covers the two we need
  // even across weekends/holidays). Paginated — a handful of names, but the
  // window can still exceed one page.
  const sinceIso = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const priceRows = await fetchAllRows<PriceRow>(
    (from, to) =>
      supabase
        .from("price_snapshots")
        .select("security_id, snapshot_date, close, currency")
        .in("security_id", securityIds)
        .gte("snapshot_date", sinceIso)
        .order("security_id", { ascending: true })
        .order("snapshot_date", { ascending: false })
        .range(from, to),
    "held prices",
  );

  // Two most recent closes per security.
  const latest = new Map<string, PriceRow>();
  const previous = new Map<string, PriceRow>();
  for (const p of priceRows) {
    if (!latest.has(p.security_id)) latest.set(p.security_id, p);
    else if (!previous.has(p.security_id)) previous.set(p.security_id, p);
  }

  // Latest succeeded verdict per held security (shared fetch — see above).
  const verdictData = await loadHeldVerdictRows(supabase, portfolioId);

  const latestVerdict = new Map<string, HeldVerdictRow>();
  for (const v of verdictData ?? []) {
    if (!v.security_id || !v.report) continue;
    const existing = latestVerdict.get(v.security_id);
    if (
      !existing ||
      (existing.report &&
        v.report.generated_at > existing.report.generated_at)
    ) {
      latestVerdict.set(v.security_id, v);
    }
  }

  return rows.map((h) => {
    const l = latest.get(h.security_id) ?? null;
    const p = previous.get(h.security_id) ?? null;
    const v = latestVerdict.get(h.security_id) ?? null;
    return {
      holdingId: h.id,
      securityId: h.security_id,
      ticker: h.security?.ticker ?? "—",
      exchange: h.security?.exchange ?? "",
      name: h.security?.name ?? "",
      quantity: h.quantity,
      purchasePrice: h.purchase_price,
      purchaseCurrency: h.purchase_currency,
      purchaseDate: h.purchase_date,
      notes: h.notes,
      latestClose: l?.close ?? null,
      previousClose: p?.close ?? null,
      priceCurrency: l?.currency ?? h.security?.currency ?? null,
      priceAsOf: l?.snapshot_date ?? null,
      classification: v?.classification ?? null,
      composite: v?.composite_score ?? null,
      coverage: v?.scoring_breakdown?.coverage ?? null,
      verdictAgent: v?.report?.agent_name ?? null,
      verdictReportId: v?.report?.id ?? null,
      verdictAt: v?.report?.generated_at ?? null,
    };
  });
}
