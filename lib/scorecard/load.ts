import type { SupabaseClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";
import { summariseBands, type BandSummary, type OutcomeRow } from "./calc";

/**
 * Read side of the scorecard — RLS-scoped client (entitled read), safe on a
 * request path. Aggregation happens here from the persisted rows; nothing is
 * recomputed against price history at render time.
 */

export interface Scorecard {
  bands: BandSummary[];
  totalOutcomes: number;
  /** Verdict date range covered (t0), for the "since" line. */
  from: string | null;
  to: string | null;
  computedAt: string | null;
}

interface DbRow {
  security_id: string;
  classification: string;
  t0_date: string;
  computed_at: string;
  r1: number | null;
  r5: number | null;
  r20: number | null;
  universe_r1: number | null;
  universe_r5: number | null;
  universe_r20: number | null;
}

export async function loadScorecard(
  supabase: SupabaseClient,
): Promise<Scorecard> {
  const { data, error } = await supabase
    .from("verdict_outcomes")
    .select(
      "security_id, classification, t0_date, computed_at, r1, r5, r20, universe_r1, universe_r5, universe_r20",
    )
    .eq("agent_name", "reaction")
    .order("t0_date", { ascending: true })
    .returns<DbRow[]>();
  if (error) {
    // Deploy-order tolerance: the code can reach production before migration
    // 0016 has been applied. A missing table must degrade to the empty state
    // ("no outcomes computed yet"), not 500 the whole Data health page.
    console.error(`scorecard load: ${getErrorMessage(error)}`);
    return {
      bands: summariseBands([]),
      totalOutcomes: 0,
      from: null,
      to: null,
      computedAt: null,
    };
  }

  const rows: OutcomeRow[] = (data ?? []).map((r) => ({
    classification: r.classification,
    securityId: r.security_id,
    r: { 1: r.r1, 5: r.r5, 20: r.r20 },
    universe: { 1: r.universe_r1, 5: r.universe_r5, 20: r.universe_r20 },
  }));

  return {
    bands: summariseBands(rows),
    totalOutcomes: rows.length,
    from: data?.[0]?.t0_date ?? null,
    to: data?.length ? data[data.length - 1].t0_date : null,
    computedAt: data?.length
      ? data.reduce((m, r) => (r.computed_at > m ? r.computed_at : m), data[0].computed_at)
      : null,
  };
}
