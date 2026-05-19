import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";
import type { AgentName, EvidenceItem, RankedReport } from "./types";

/**
 * Persist a RankedReport.
 *
 * Writes three table-sets atomically-ish: agent_runs (1 row), reports (1 row),
 * report_items (N rows), evidence (M rows). Supabase doesn't expose
 * transactions over the REST API, so the order matters — failure at any step
 * leaves the run in `failed` status which the UI can flag.
 *
 * Inputs:
 *   agentName, frameworkId, report, bodyMarkdown
 *
 * Returns the report UUID for use in URLs.
 */
export async function persistReport(input: {
  agentName: AgentName;
  frameworkId: string;
  report: RankedReport;
  bodyMarkdown: string;
  trigger?: "scheduled" | "manual" | "event";
  inputParams?: Record<string, unknown>;
}): Promise<{ reportId: string; runId: string }> {
  const supabase = createServiceClient();

  // 1. Create the agent_run record in 'running' state.
  const { data: run, error: runErr } = await supabase
    .from("agent_runs")
    .insert({
      agent_name: input.agentName,
      framework_id: input.frameworkId,
      status: "running",
      trigger: input.trigger ?? "manual",
      input_params: input.inputParams ?? {},
    })
    .select("id")
    .single<{ id: string }>();
  if (runErr || !run) {
    throw new Error(`persistReport: agent_runs insert failed: ${getErrorMessage(runErr)}`);
  }

  try {
    // 2. reports row
    const { data: reportRow, error: reportErr } = await supabase
      .from("reports")
      .insert({
        agent_run_id: run.id,
        agent_name: input.agentName,
        generated_at: input.report.generatedAt,
        summary_markdown: input.report.summaryMarkdown,
        body_markdown: input.bodyMarkdown,
      })
      .select("id")
      .single<{ id: string }>();
    if (reportErr || !reportRow) {
      throw new Error(`reports insert failed: ${getErrorMessage(reportErr)}`);
    }

    // 3. report_items rows (one per ranked candidate)
    const itemRows = input.report.ranked.map((candidate, idx) => ({
      report_id: reportRow.id,
      security_id: candidate.securityId,
      rank: idx + 1,
      composite_score: candidate.composite,
      scoring_breakdown: candidate.breakdown,
      verdict: null,
      classification: null,
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

    // 4. evidence rows. Each evidence row attaches to the report_item for the
    // candidate whose ranked position references it via evidenceRefs.
    const evidenceRows = buildEvidenceRows(
      input.report,
      createdItems,
    );
    if (evidenceRows.length > 0) {
      const { error: evErr } = await supabase
        .from("evidence")
        .insert(evidenceRows);
      if (evErr) {
        throw new Error(`evidence insert failed: ${getErrorMessage(evErr)}`);
      }
    }

    // 5. Mark run succeeded
    await supabase
      .from("agent_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", run.id);

    return { reportId: reportRow.id, runId: run.id };
  } catch (err) {
    await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: getErrorMessage(err),
      })
      .eq("id", run.id);
    throw err;
  }
}

function buildEvidenceRows(
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
