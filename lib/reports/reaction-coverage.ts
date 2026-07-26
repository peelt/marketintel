import type { SupabaseClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";

/**
 * UK-vs-US evidence split for the Reaction desk.
 *
 * The LSE fundamentals gap (Finnhub blocks LSE lookups on the current plan)
 * predicts that London names file with systematically thinner coverage than
 * US names — the two fundamentals sub-signals (`leverage_fragility`,
 * `cash_generation`, ≈18% of framework weight) null out and redistribute.
 * This module measures whether that's actually happening in filed reports,
 * so the "London fundamentals decision" (pay for a source vs accept the gap)
 * can be made from live numbers instead of theory. Surfaced on Data health.
 */

interface BreakdownJson {
  coverage?: number;
  criteria?: Record<
    string,
    { score: number | null; signals?: Record<string, number | null> }
  >;
}

export interface CoverageItemRow {
  report_id: string;
  classification: string | null;
  scoring_breakdown: BreakdownJson | null;
  security: { ticker: string; exchange: string } | null;
}

export interface MarketCoverage {
  market: "US" | "LSE";
  /** Scored appearances (a name can appear in several editions). */
  n: number;
  /** Mean coverage share, 0–1, across appearances (null when n=0). */
  avgCoverage: number | null;
  /** Appearances with a non-null news damage grade (the defining evidence). */
  withNews: number;
  /** Appearances with at least one non-null fundamentals signal. */
  withFundamentals: number;
}

export interface ReactionCoverageSplit {
  editions: number;
  from: string | null;
  to: string | null;
  markets: MarketCoverage[];
}

function signalOf(b: BreakdownJson | null, criterion: string, signal: string) {
  return b?.criteria?.[criterion]?.signals?.[signal] ?? null;
}

/**
 * Aggregate filed report items into the per-market evidence summary.
 * Pure — unit-tested. Unknown exchanges are counted as US (the broad universe
 * only carries "US" and "LSE"; anything else would be a data bug worth seeing
 * in the US bucket rather than silently dropped).
 */
export function summariseReactionCoverage(
  rows: CoverageItemRow[],
): MarketCoverage[] {
  const groups: Record<"US" | "LSE", CoverageItemRow[]> = { US: [], LSE: [] };
  for (const r of rows) {
    const market = r.security?.exchange === "LSE" ? "LSE" : "US";
    groups[market].push(r);
  }
  return (["US", "LSE"] as const).map((market) => {
    const items = groups[market];
    const coverages = items
      .map((i) => i.scoring_breakdown?.coverage)
      .filter((c): c is number => typeof c === "number");
    return {
      market,
      n: items.length,
      avgCoverage:
        coverages.length > 0
          ? coverages.reduce((s, c) => s + c, 0) / coverages.length
          : null,
      withNews: items.filter(
        (i) =>
          signalOf(i.scoring_breakdown, "earned_damage", "news_damage_severity") !==
          null,
      ).length,
      withFundamentals: items.filter(
        (i) =>
          signalOf(i.scoring_breakdown, "earned_damage", "leverage_fragility") !==
            null ||
          signalOf(i.scoring_breakdown, "earned_damage", "cash_generation") !==
            null,
      ).length,
    };
  });
}

/** Load the split over the last `editions` succeeded reaction reports. */
export async function loadReactionCoverageSplit(
  supabase: SupabaseClient,
  editions = 5,
): Promise<ReactionCoverageSplit> {
  const { data: reports, error: repErr } = await supabase
    .from("reports")
    .select("id, generated_at, agent_runs!inner(status)")
    .eq("agent_name", "reaction")
    .eq("agent_runs.status", "succeeded")
    .order("generated_at", { ascending: false })
    .limit(editions)
    .returns<{ id: string; generated_at: string }[]>();
  if (repErr) {
    throw new Error(`reaction coverage reports: ${getErrorMessage(repErr)}`);
  }
  if (!reports || reports.length === 0) {
    return { editions: 0, from: null, to: null, markets: summariseReactionCoverage([]) };
  }

  const { data: items, error: itemsErr } = await supabase
    .from("report_items")
    .select(
      "report_id, classification, scoring_breakdown, security:securities(ticker, exchange)",
    )
    .in("report_id", reports.map((r) => r.id))
    .returns<CoverageItemRow[]>();
  if (itemsErr) {
    throw new Error(`reaction coverage items: ${getErrorMessage(itemsErr)}`);
  }

  return {
    editions: reports.length,
    from: reports[reports.length - 1].generated_at,
    to: reports[0].generated_at,
    markets: summariseReactionCoverage(items ?? []),
  };
}
