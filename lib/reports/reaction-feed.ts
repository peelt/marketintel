import type { SupabaseClient } from "@supabase/supabase-js";
import { severityOf } from "@/lib/holdings/deltas";
import { getErrorMessage } from "@/lib/errors";
import { loadRecentDeskReports, splitDeskReports } from "./desk-reports";

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
  /**
   * When the desk last screened the whole universe — the latest DAILY
   * edition, even if outside the window. Not an on-demand run: that screens
   * one name, and showing its time read as "the desk ran at 12:11".
   */
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
 *
 * `onlyTickers` limits an on-demand run to the names it was ASKED about. When
 * the requested name qualifies, that run grades the whole screened cohort
 * again for rank context; without this its re-graded verdicts — being newer —
 * replaced the morning edition's for every name in the feed, each linking to
 * someone's single-name analysis.
 */
export function dedupRecentDrops(
  rows: ItemRow[],
  reportTimes: Map<string, string>,
  onlyTickers: Map<string, Set<string>> = new Map(),
): ReactionDrop[] {
  const bySecurity = new Map<string, ReactionDrop>();
  for (const r of rows) {
    if (!r.security_id || !r.classification) continue;
    const screenedAt = reportTimes.get(r.report_id);
    if (!screenedAt) continue;
    const allowed = onlyTickers.get(r.report_id);
    if (allowed && !allowed.has((r.security?.ticker ?? "").toUpperCase())) continue;
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
  // One newest-first read serves both facts this feed needs: the latest daily
  // edition (the "last screened" line, shown even when it predates the
  // window — that's the honest "gone quiet" state) and every run inside the
  // window. Shared with the desk card, which wants the same rows.
  const recent = await loadRecentDeskReports(supabase, "reaction");
  const { editions, onDemand } = splitDeskReports(recent);
  const lastScreenedAt = editions[0]?.generated_at ?? null;

  // The feed draws on the daily editions in the window, plus each on-demand
  // run for the names it was asked about. (Manual same-day re-runs are set
  // aside, as on the reports page.)
  const sinceMs = now - WINDOW_HOURS * 60 * 60 * 1000;
  const inWindow = (r: { generated_at: string }) => Date.parse(r.generated_at) >= sinceMs;
  const reportTimes = new Map<string, string>();
  const onlyTickers = new Map<string, Set<string>>();
  for (const r of editions.filter(inWindow)) reportTimes.set(r.id, r.generated_at);
  for (const r of onDemand.filter(inWindow)) {
    reportTimes.set(r.id, r.generated_at);
    onlyTickers.set(r.id, new Set(r.requestedTickers.map((t) => t.trim().toUpperCase())));
  }
  if (reportTimes.size === 0) {
    return { drops: [], lastScreenedAt, windowHours: WINDOW_HOURS };
  }

  const { data: items, error: itemsErr } = await supabase
    .from("report_items")
    .select(
      "security_id, classification, composite_score, scoring_breakdown, report_id, security:securities(ticker, name)",
    )
    .in("report_id", [...reportTimes.keys()])
    // A corporate action is not a drop — it must never surface in the
    // rolling 48h feed as one.
    .not(
      "classification",
      "in",
      "(insufficient_data,cause_unconfirmed,corporate_action)",
    )
    .returns<ItemRow[]>();
  if (itemsErr) throw new Error(`reaction feed items: ${getErrorMessage(itemsErr)}`);

  return {
    drops: dedupRecentDrops(items ?? [], reportTimes, onlyTickers),
    lastScreenedAt,
    windowHours: WINDOW_HOURS,
  };
}
