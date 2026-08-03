import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadBroadUniverse, loadRecentSeries } from "@/lib/agents/reaction/data";
import type { SessionRow } from "@/lib/agents/reaction/metrics";
import { getErrorMessage } from "@/lib/errors";
import {
  forwardReturn,
  latestSessionOnOrBefore,
  medianOf,
  SCORED_BANDS,
  WINDOWS,
  type Window,
} from "./calc";

/**
 * Scorecard computation — Inngest/service contexts ONLY (service-role client;
 * never import from a request path). Finds classified reaction verdicts whose
 * outcome windows can mature further, computes forward + universe-median
 * returns, and upserts verdict_outcomes. Idempotent: re-running fills nulls
 * as windows mature and leaves matured rows unchanged.
 */

/** How far back a verdict stays in the compute set: t+20 sessions ≈ a month
 * of trading; 60 calendar days covers it with holiday slack. */
const LOOKBACK_DAYS = 60;
/** Series span: lookback plus enough history to anchor each t0. */
const SERIES_DAYS = LOOKBACK_DAYS + 20;

interface VerdictItemRow {
  id: string;
  security_id: string;
  classification: string;
  composite_score: number | null;
  report: { generated_at: string; agent_name: string } | null;
}

export interface ScorecardRunResult {
  considered: number;
  written: number;
  skippedNoSeries: number;
}

export async function computeVerdictOutcomes(): Promise<ScorecardRunResult> {
  const supabase = createServiceClient();
  const sinceIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Classified reaction items from succeeded runs in the maturation window.
  // The join goes item -> report -> run; failed/half-persisted runs never
  // produce outcomes, same rule as every other surface.
  const items = await fetchAllRows<VerdictItemRow>(
    (from, to) =>
      supabase
        .from("report_items")
        .select(
          "id, security_id, classification, composite_score, report:reports!inner(generated_at, agent_name, agent_runs!inner(status))",
        )
        .eq("report.agent_name", "reaction")
        .eq("report.agent_runs.status", "succeeded")
        .in("classification", [...SCORED_BANDS])
        .gte("report.generated_at", sinceIso)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<VerdictItemRow[]>(),
    "scorecard verdict items",
  );
  if (items.length === 0) {
    return { considered: 0, written: 0, skippedNoSeries: 0 };
  }

  // One series load covers both the verdict names and the universe medians.
  const universe = await loadBroadUniverse();
  const universeIds = universe.map((u) => u.id);
  const verdictIds = [...new Set(items.map((i) => i.security_id))];
  const allIds = [...new Set([...universeIds, ...verdictIds])];
  const series = await loadRecentSeries(allIds, SERIES_DAYS);

  // Universe medians are shared across every verdict filed the same day —
  // compute once per (t0 date, window).
  const universeMedianCache = new Map<string, number | null>();
  const universeMedian = (t0Date: string, w: Window): number | null => {
    const key = `${t0Date}:${w}`;
    const cached = universeMedianCache.get(key);
    if (cached !== undefined) return cached;
    const returns: number[] = [];
    for (const id of universeIds) {
      const s = series.get(id) ?? [];
      const t0 = latestSessionOnOrBefore(s, t0Date);
      if (!t0) continue;
      const r = forwardReturn(s, t0, w);
      if (r !== null) returns.push(r);
    }
    // A median over a thin sliver of the universe isn't a benchmark — below
    // half coverage, record "not computable" rather than a biased number.
    const value = returns.length >= universeIds.length / 2 ? medianOf(returns) : null;
    universeMedianCache.set(key, value);
    return value;
  };

  let written = 0;
  let skippedNoSeries = 0;
  const upserts: Record<string, unknown>[] = [];

  for (const item of items) {
    const genDate = (item.report?.generated_at ?? "").slice(0, 10);
    const s = series.get(item.security_id) ?? [];
    const t0Date = genDate ? latestSessionOnOrBefore(s, genDate) : null;
    if (!t0Date) {
      skippedNoSeries++;
      continue;
    }
    const t0Close = s.find((row) => row.date === t0Date)!.close;

    const r: Record<Window, number | null> = { 1: null, 5: null, 20: null };
    const u: Record<Window, number | null> = { 1: null, 5: null, 20: null };
    for (const w of WINDOWS) {
      r[w] = forwardReturn(s, t0Date, w);
      u[w] = r[w] === null ? null : universeMedian(t0Date, w);
    }

    upserts.push({
      report_item_id: item.id,
      security_id: item.security_id,
      agent_name: "reaction",
      classification: item.classification,
      composite_score: item.composite_score,
      t0_date: t0Date,
      t0_close: t0Close,
      r1: r[1],
      r5: r[5],
      r20: r[20],
      universe_r1: u[1],
      universe_r5: u[5],
      universe_r20: u[20],
      computed_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < upserts.length; i += 200) {
    const chunk = upserts.slice(i, i + 200);
    const { error } = await supabase
      .from("verdict_outcomes")
      .upsert(chunk, { onConflict: "report_item_id" });
    if (error) {
      throw new Error(`scorecard upsert failed: ${getErrorMessage(error)}`);
    }
    written += chunk.length;
  }

  return { considered: items.length, written, skippedNoSeries };
}

/** Narrow re-export so the Inngest function doesn't reach into internals. */
export type { SessionRow };
