import type { SupabaseClient } from "@supabase/supabase-js";
import { severityOf } from "@/lib/holdings/deltas";
import { getErrorMessage } from "@/lib/errors";

/**
 * The Reaction Analyser is the one PERISHABLE desk — a sharp drop is a dated
 * event, and an "overshoot" verdict is worthless once the move has re-rated. So
 * the dashboard treats Reaction as a ROLLING feed of the drops screened in the
 * last N hours, not as the "latest edition" — anything older ages out by
 * construction, and when nothing's fresh the card says so rather than parading
 * days-old drops as current signals.
 */

const WINDOW_HOURS = 48;

export interface ReactionDrop {
  securityId: string;
  ticker: string;
  name: string | null;
  classification: string | null;
  composite: number | null;
  coverage: number | null;
  reportId: string;
  /** When the run that flagged this drop filed — the drop's freshness. */
  screenedAt: string;
}

export interface ReactionFeed {
  /** Deduped (freshest per name), most-concerning first. Empty = calm market. */
  drops: ReactionDrop[];
  /** The most recent Reaction run overall (even if outside the window). */
  lastScreenedAt: string | null;
  windowHours: number;
}

interface ItemRow {
  security_id: string | null;
  classification: string | null;
  composite_score: number;
  scoring_breakdown: { coverage?: number } | null;
  report_id: string;
  security: { ticker: string; name: string | null } | null;
}

/**
 * Dedup drop rows to one per security (the freshest run that flagged it) and
 * order most-concerning first, then most-recent. Pure — unit-tested.
 */
export function dedupRecentDrops(
  rows: ItemRow[],
  reportTimes: Map<string, string>,
): ReactionDrop[] {
  const bySecurity = new Map<string, ReactionDrop>();
  for (const r of rows) {
    if (!r.security_id || !r.classification) continue;
    const screenedAt = reportTimes.get(r.report_id);
    if (!screenedAt) continue;
    const existing = bySecurity.get(r.security_id);
    if (existing && existing.screenedAt >= screenedAt) continue;
    bySecurity.set(r.security_id, {
      securityId: r.security_id,
      ticker: r.security?.ticker ?? "—",
      name: r.security?.name ?? null,
      classification: r.classification,
      composite: r.composite_score,
      coverage: r.scoring_breakdown?.coverage ?? null,
      reportId: r.report_id,
      screenedAt,
    });
  }
  return [...bySecurity.values()].sort((a, b) => {
    const s = severityOf(b.classification).rank - severityOf(a.classification).rank;
    if (s !== 0) return s;
    return b.screenedAt.localeCompare(a.screenedAt);
  });
}

export async function loadReactionFeed(
  supabase: SupabaseClient,
  now: number = Date.now(),
): Promise<ReactionFeed> {
  // The most recent Reaction run overall, for the "last screened" line — shown
  // even when it's older than the window (that's the honest "gone quiet" state).
  const { data: latest, error: latestErr } = await supabase
    .from("reports")
    .select("generated_at, agent_runs!inner(status)")
    .eq("agent_name", "reaction")
    .eq("agent_runs.status", "succeeded")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ generated_at: string }>();
  if (latestErr) throw new Error(`reaction feed latest: ${getErrorMessage(latestErr)}`);
  const lastScreenedAt = latest?.generated_at ?? null;

  const sinceIso = new Date(now - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data: reports, error: repErr } = await supabase
    .from("reports")
    .select("id, generated_at, agent_runs!inner(status)")
    .eq("agent_name", "reaction")
    .eq("agent_runs.status", "succeeded")
    .gte("generated_at", sinceIso)
    .returns<{ id: string; generated_at: string }[]>();
  if (repErr) throw new Error(`reaction feed reports: ${getErrorMessage(repErr)}`);

  const reportTimes = new Map<string, string>();
  for (const r of reports ?? []) reportTimes.set(r.id, r.generated_at);
  if (reportTimes.size === 0) {
    return { drops: [], lastScreenedAt, windowHours: WINDOW_HOURS };
  }

  const { data: items, error: itemsErr } = await supabase
    .from("report_items")
    .select(
      "security_id, classification, composite_score, scoring_breakdown, report_id, security:securities(ticker, name)",
    )
    .in("report_id", [...reportTimes.keys()])
    .not("classification", "in", "(insufficient_data,cause_unconfirmed)")
    .returns<ItemRow[]>();
  if (itemsErr) throw new Error(`reaction feed items: ${getErrorMessage(itemsErr)}`);

  return {
    drops: dedupRecentDrops(items ?? [], reportTimes),
    lastScreenedAt,
    windowHours: WINDOW_HOURS,
  };
}
