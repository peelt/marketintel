import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDeskDelta, type DeskDelta } from "./desk-deltas";

/**
 * Desk-card data for the dashboard, in as few round-trips as possible and
 * process-cached. This data is NOT user-specific — reports and report_items
 * are entitled-read and identical for every user — so a short-TTL process
 * cache is safe and makes repeat navigations near-instant. Reports change only
 * when a desk files (a cron a few times a week), so a couple of minutes stale
 * is fine.
 *
 * One fetch of the latest TWO editions per desk + one fetch of their items
 * yields both the card (latest edition, classified names) AND the delta vs the
 * previous edition — replacing the old ~20 sequential queries.
 */

export interface DeskReport {
  id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
}

export interface DeskClassifiedItem {
  rank: number;
  composite_score: number;
  classification: string | null;
  scoring_breakdown: { coverage?: number } | null;
  security: { ticker: string; name: string | null } | null;
}

export interface DeskCard {
  agentName: string;
  report: DeskReport | null;
  classified: DeskClassifiedItem[];
  delta: DeskDelta | null;
}

interface ReportRow extends DeskReport {
  agent_runs: { status: string } | null;
}
interface ItemRow extends DeskClassifiedItem {
  report_id: string;
  security_id: string | null;
}

const TTL_MS = 3 * 60 * 1000;
let cache: { at: number; cards: DeskCard[] } | null = null;

/** Clear the cache (used by tests; harmless in prod). */
export function clearDeskCardCache(): void {
  cache = null;
}

function isCardClassification(c: string | null): boolean {
  return !!c && c !== "insufficient_data" && c !== "cause_unconfirmed";
}

export async function loadDeskCards(
  supabase: SupabaseClient,
  agentNames: string[],
  now: number = Date.now(),
): Promise<DeskCard[]> {
  if (cache && now - cache.at < TTL_MS) return cache.cards;

  // Latest two succeeded editions per desk (parallel). [0] drives the card,
  // [1] is the baseline for the delta.
  const perDesk = await Promise.all(
    agentNames.map(async (name) => {
      const { data } = await supabase
        .from("reports")
        .select(
          "id, agent_name, generated_at, summary_markdown, agent_runs!inner(status)",
        )
        .eq("agent_name", name)
        .eq("agent_runs.status", "succeeded")
        .order("generated_at", { ascending: false })
        .limit(2)
        .returns<ReportRow[]>();
      return { name, reports: data ?? [] };
    }),
  );

  const allIds = perDesk.flatMap((d) => d.reports.map((r) => r.id));
  let items: ItemRow[] = [];
  if (allIds.length > 0) {
    const { data } = await supabase
      .from("report_items")
      .select(
        "report_id, security_id, rank, composite_score, classification, scoring_breakdown, security:securities(ticker, name)",
      )
      .in("report_id", allIds)
      .order("rank", { ascending: true })
      .limit(1000)
      .returns<ItemRow[]>();
    items = data ?? [];
  }

  const byReport = new Map<string, ItemRow[]>();
  for (const it of items) {
    const arr = byReport.get(it.report_id) ?? [];
    arr.push(it);
    byReport.set(it.report_id, arr);
  }

  const cards: DeskCard[] = perDesk.map(({ name, reports }) => {
    const latest = reports[0] ?? null;
    const previous = reports[1] ?? null;
    const latestItems = latest ? (byReport.get(latest.id) ?? []) : [];

    const classified = latestItems
      .filter((i) => isCardClassification(i.classification))
      .slice(0, 60);

    let delta: DeskDelta | null = null;
    if (latest && previous) {
      const d = computeDeskDelta(
        latestItems
          .filter((i) => i.security_id)
          .map((i) => ({ securityId: i.security_id!, classification: i.classification })),
        (byReport.get(previous.id) ?? [])
          .filter((i) => i.security_id)
          .map((i) => ({ securityId: i.security_id!, classification: i.classification })),
      );
      if (d.upgrades > 0 || d.downgrades > 0) delta = d;
    }

    return {
      agentName: name,
      report: latest
        ? {
            id: latest.id,
            agent_name: latest.agent_name,
            generated_at: latest.generated_at,
            summary_markdown: latest.summary_markdown,
          }
        : null,
      classified,
      delta,
    };
  });

  cache = { at: now, cards };
  return cards;
}
