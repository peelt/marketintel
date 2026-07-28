import type { SupabaseClient } from "@supabase/supabase-js";
import { severityOf } from "@/lib/holdings/deltas";
import { getErrorMessage } from "@/lib/errors";

/**
 * Desk-level movement: how many names a desk UPGRADED or DOWNGRADED between its
 * two most recent editions. This is what makes the dashboard read as a living
 * desk rather than a report archive — "↑2 upgrades since last edition".
 *
 * Movement is measured by concern rank (lib/holdings/deltas severity), so it's
 * vocabulary-agnostic across desks. Names present in only one edition, or
 * carrying no real classification, don't count as a move.
 */

export interface DeskDelta {
  upgrades: number;
  downgrades: number;
}

interface ClassifiedName {
  securityId: string;
  classification: string | null;
}

function isReal(c: string | null): c is string {
  return (
    !!c &&
    c !== "insufficient_data" &&
    c !== "cause_unconfirmed" &&
    c !== "corporate_action"
  );
}

export function computeDeskDelta(
  latest: ClassifiedName[],
  previous: ClassifiedName[],
): DeskDelta {
  const prev = new Map(previous.map((p) => [p.securityId, p.classification]));
  let upgrades = 0;
  let downgrades = 0;
  for (const l of latest) {
    if (!isReal(l.classification)) continue;
    const before = prev.get(l.securityId);
    if (before === undefined || !isReal(before)) continue;
    // Lower concern rank = better position = an upgrade.
    const after = severityOf(l.classification).rank;
    const was = severityOf(before).rank;
    if (after < was) upgrades++;
    else if (after > was) downgrades++;
  }
  return { upgrades, downgrades };
}

interface ReportIdRow {
  id: string;
}
interface ItemRow {
  report_id: string;
  security_id: string | null;
  classification: string | null;
}

/** Per desk, the up/downgrade counts between its latest two succeeded editions. */
export async function loadDeskDeltas(
  supabase: SupabaseClient,
  agentNames: string[],
): Promise<Map<string, DeskDelta>> {
  const out = new Map<string, DeskDelta>();
  await Promise.all(
    agentNames.map(async (name) => {
      const { data: reports, error } = await supabase
        .from("reports")
        .select("id, generated_at, agent_runs!inner(status)")
        .eq("agent_name", name)
        .eq("agent_runs.status", "succeeded")
        .order("generated_at", { ascending: false })
        .limit(2)
        .returns<ReportIdRow[]>();
      if (error) throw new Error(`deskDeltas ${name}: ${getErrorMessage(error)}`);
      if (!reports || reports.length < 2) return; // need two editions to diff

      const latestId = reports[0].id;
      const prevId = reports[1].id;
      const { data: items, error: itemsErr } = await supabase
        .from("report_items")
        .select("report_id, security_id, classification")
        .in("report_id", [latestId, prevId])
        .returns<ItemRow[]>();
      if (itemsErr) {
        throw new Error(`deskDeltas items ${name}: ${getErrorMessage(itemsErr)}`);
      }

      const latest: ClassifiedName[] = [];
      const previous: ClassifiedName[] = [];
      for (const it of items ?? []) {
        if (!it.security_id) continue;
        const row = { securityId: it.security_id, classification: it.classification };
        if (it.report_id === latestId) latest.push(row);
        else previous.push(row);
      }
      const delta = computeDeskDelta(latest, previous);
      if (delta.upgrades > 0 || delta.downgrades > 0) out.set(name, delta);
    }),
  );
  return out;
}
