import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";
import { buildEditionIndex, onDemandTickers } from "./editions";

/**
 * A desk's most recent succeeded editions, resolved once per request.
 *
 * The dashboard needs the same `reports` rows three times over: the desk card
 * wants the latest two (headline + delta baseline), and the rolling 48h feed
 * wanted both "the newest edition ever" and "every edition inside the window".
 * Those were three separate round-trips against one small, identical result
 * set. One newest-first read serves all three; callers slice or filter.
 */

export interface DeskReportRow {
  id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
  /** agent_runs.trigger — 'scheduled' | 'manual' | 'event'. */
  trigger: string | null;
  /** The tickers an on-demand run was asked for; null for a full-universe run. */
  requestedTickers: string[] | null;
}

interface RawRow {
  id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
  agent_runs: { status: string; trigger: string | null; input_params: unknown } | null;
}

/**
 * How many report rows to hold. Comfortably covers the desk card (2 editions)
 * and any 48h window at a daily cadence, with room for on-demand runs. If a window
 * ever exceeded this, the feed would simply draw from the newest N — it
 * renders at most 6 drops.
 */
const RECENT_LIMIT = 15;

export const loadRecentDeskReports = cache(
  async (
    supabase: SupabaseClient,
    agentName: string,
  ): Promise<DeskReportRow[]> => {
    const { data, error } = await supabase
      .from("reports")
      .select(
        "id, agent_name, generated_at, summary_markdown, agent_runs!inner(status, trigger, input_params)",
      )
      .eq("agent_name", agentName)
      .eq("agent_runs.status", "succeeded")
      .order("generated_at", { ascending: false })
      .limit(RECENT_LIMIT)
      .returns<RawRow[]>();
    if (error) {
      throw new Error(`loadRecentDeskReports(${agentName}): ${getErrorMessage(error)}`);
    }
    // input_params stays here: only the requested tickers leave this module.
    return (data ?? []).map((r) => ({
      id: r.id,
      agent_name: r.agent_name,
      generated_at: r.generated_at,
      summary_markdown: r.summary_markdown,
      trigger: r.agent_runs?.trigger ?? null,
      requestedTickers: onDemandTickers(r.agent_runs?.input_params),
    }));
  },
);

/**
 * Split a desk's recent report rows into its DAILY EDITIONS and its on-demand
 * runs — the same rule the reports page uses (`buildEditionIndex`).
 *
 * A report row is not necessarily an edition. An on-demand per-ticker run
 * files a report too, and when the requested name qualifies it grades the
 * WHOLE screened cohort again (for rank context), so its row looks like a
 * full edition. Treated as "the newest report", it became the dashboard's
 * latest edition, its time the "last screened" line, and its re-graded
 * verdicts replaced the morning edition's for every name in the 48h feed. A
 * manual same-day re-run is set aside the same way (the scheduled run is the
 * day's edition). Pure — unit-tested.
 */
export function splitDeskReports(rows: DeskReportRow[]): {
  /** One per date, newest first. */
  editions: DeskReportRow[];
  /** On-demand runs, newest first, each with its requested tickers. */
  onDemand: (DeskReportRow & { requestedTickers: string[] })[];
} {
  const index = buildEditionIndex(
    rows.map((r) => ({
      id: r.id,
      agent_name: r.agent_name,
      generated_at: r.generated_at,
      summary_markdown: r.summary_markdown,
      trigger: r.trigger,
      input_params: { tickers: r.requestedTickers },
    })),
  );
  const editionIds = new Set(index.editions.map((e) => e.id));
  const newestFirst = [...rows].sort(
    (a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at),
  );
  return {
    editions: newestFirst.filter((r) => editionIds.has(r.id)),
    onDemand: newestFirst.filter(
      (r): r is DeskReportRow & { requestedTickers: string[] } =>
        r.requestedTickers !== null,
    ),
  };
}
