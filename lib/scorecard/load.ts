import type { SupabaseClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";
import {
  SCORED_BANDS,
  summariseBands,
  type BandSummary,
  type OutcomeRow,
} from "./calc";

/**
 * Read side of the scorecard — RLS-scoped client (entitled read), safe on a
 * request path. Aggregation happens here from the persisted rows; nothing is
 * recomputed against price history at render time.
 */

export interface Scorecard {
  bands: BandSummary[];
  totalOutcomes: number;
  /** True when verdict_outcomes doesn't exist yet (migration 0016 unapplied). */
  tableMissing: boolean;
  /**
   * Classified reaction verdicts the job COULD have scored. "0 computed from
   * 135 eligible" says the job isn't running; "0 from 0" says there's nothing
   * to do. Collapsing those into one empty state hid a real failure.
   */
  eligibleVerdicts: number;
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
  const eligibleVerdicts = await countEligibleVerdicts(supabase);

  if (error) {
    // Deploy-order tolerance: the code can reach production before migration
    // 0016 has been applied. A missing table must degrade to an empty state,
    // not 500 the whole Data health page — but it must SAY it's missing, or
    // "not applied yet" and "applied but the job never ran" look identical
    // and point at different fixes.
    console.error(`scorecard load: ${getErrorMessage(error)}`);
    return {
      bands: summariseBands([]),
      totalOutcomes: 0,
      tableMissing: true,
      eligibleVerdicts,
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
    tableMissing: false,
    eligibleVerdicts,
    from: data?.[0]?.t0_date ?? null,
    to: data?.length ? data[data.length - 1].t0_date : null,
    computedAt: data?.length
      ? data.reduce((m, r) => (r.computed_at > m ? r.computed_at : m), data[0].computed_at)
      : null,
  };
}

/** How many classified reaction verdicts are eligible for scoring. */
async function countEligibleVerdicts(
  supabase: SupabaseClient,
): Promise<number> {
  const { count, error } = await supabase
    .from("report_items")
    .select("id, report:reports!inner(agent_name)", { count: "exact", head: true })
    .eq("report.agent_name", "reaction")
    .in("classification", [...SCORED_BANDS]);
  if (error) {
    console.error(`scorecard eligible count: ${getErrorMessage(error)}`);
    return 0;
  }
  return count ?? 0;
}
