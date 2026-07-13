import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";
import type { EvidenceItem, RankedReport } from "./types";

/**
 * Persist a RankedReport against an EXISTING agent_runs row.
 *
 * Run lifecycle lives in runAgent (lib/agents/run.ts): the run row is created
 * BEFORE the agent executes, so failures anywhere — including inside
 * agent.run() itself — always leave an auditable failed run. This module only
 * writes the report artefacts: reports (1 row), report_items (N), evidence (M).
 *
 * Supabase's REST API has no transactions, so on partial failure we
 * best-effort delete the reports row (cascade removes items + evidence) and
 * rethrow — and the /reports UI additionally filters on run status, so a
 * half-persisted report can never render as a good one.
 */
export async function persistReport(input: {
  runId: string;
  report: RankedReport;
  bodyMarkdown?: string;
}): Promise<{ reportId: string }> {
  const supabase = createServiceClient();
  const { runId, report } = input;
  const bodyMarkdown = input.bodyMarkdown ?? report.bodyMarkdown;

  // 1. reports row
  const { data: reportRow, error: reportErr } = await supabase
    .from("reports")
    .insert({
      agent_run_id: runId,
      agent_name: report.agentName,
      generated_at: report.generatedAt,
      summary_markdown: report.summaryMarkdown,
      body_markdown: bodyMarkdown,
    })
    .select("id")
    .single<{ id: string }>();
  if (reportErr || !reportRow) {
    throw new Error(`persistReport: reports insert failed: ${getErrorMessage(reportErr)}`);
  }

  try {
    // 2. report_items rows (one per ranked candidate)
    const itemRows = report.ranked.map((candidate, idx) => ({
      report_id: reportRow.id,
      security_id: candidate.securityId,
      rank: idx + 1,
      composite_score: candidate.composite,
      scoring_breakdown: {
        coverage: candidate.coverage,
        criteria: candidate.breakdown,
      },
      verdict: candidate.verdict ?? null,
      classification: candidate.classification ?? null,
    }));

    let createdItems: { id: string; rank: number }[] = [];
    if (itemRows.length > 0) {
      const { data: insertedItems, error: itemErr } = await supabase
        .from("report_items")
        .insert(itemRows)
        .select("id, rank")
        .returns<{ id: string; rank: number }[]>();
      if (itemErr || !insertedItems) {
        throw new Error(`report_items insert failed: ${getErrorMessage(itemErr)}`);
      }
      createdItems = insertedItems;
    }

    // 3. evidence rows, attached to the report_item whose ranked candidate
    // references them via evidenceRefs.
    const evidenceRows = buildEvidenceRows(report, createdItems);
    if (evidenceRows.length > 0) {
      const { error: evErr } = await supabase
        .from("evidence")
        .insert(evidenceRows);
      if (evErr) {
        throw new Error(`evidence insert failed: ${getErrorMessage(evErr)}`);
      }
    }

    return { reportId: reportRow.id };
  } catch (err) {
    // Best-effort cleanup so no orphan report survives; the run-status filter
    // in the UI is the backstop if this delete itself fails.
    await supabase.from("reports").delete().eq("id", reportRow.id);
    throw err;
  }
}

export function buildEvidenceRows(
  report: RankedReport,
  items: { id: string; rank: number }[],
) {
  type Row = {
    report_item_id: string;
    evidence_type: EvidenceItem["type"];
    source_table: string;
    source_id: string | null;
    source_text: string;
    weight: number;
  };
  const rows: Row[] = [];

  report.ranked.forEach((candidate, idx) => {
    const item = items.find((i) => i.rank === idx + 1);
    if (!item) return;
    for (const refIdx of candidate.evidenceRefs) {
      const ev = report.evidence[refIdx];
      if (!ev) continue;
      rows.push({
        report_item_id: item.id,
        evidence_type: ev.type,
        source_table: ev.sourceTable,
        source_id: isUuid(ev.sourceId) ? ev.sourceId : null,
        source_text: ev.text.slice(0, 8_000),
        weight: Math.max(0, Math.min(1, ev.weight)),
      });
    }
  });

  return rows;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
