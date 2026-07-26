import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { Disclaimer } from "@/components/disclaimer";
import { ClassificationChip, MODULE_COLORS } from "@/components/cli";
import { humanizeDateTime, stripInlineMarkdown } from "@/lib/format";
import { severityOf } from "@/lib/holdings/deltas";

export const dynamic = "force-dynamic";

interface ReportRow {
  id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
  agent_runs: { status: string } | null;
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const { userId } = await getSessionContext();
  if (!userId) redirect("/login");
  // Inner-join on the run and filter to succeeded — failed or half-persisted
  // runs must never render as legitimate reports. Retired desks' editions
  // stay in the database but are withdrawn from the product (2026-07 scope
  // reduction), so the list only shows live desks.
  const liveNames = agentRegistry
    .list()
    .filter((a) => a.status === "live")
    .map((a) => a.name);
  const { data: reports } = await supabase
    .from("reports")
    .select("id, agent_name, generated_at, summary_markdown, agent_runs!inner(status)")
    .eq("agent_runs.status", "succeeded")
    .in("agent_name", liveNames)
    .order("generated_at", { ascending: false })
    .limit(50)
    .returns<ReportRow[]>();

  // Classification counts for each desk's LATEST edition, so the list can lead
  // with chips (what the run found) instead of a grey prose snippet.
  const latestIds = groupByDesk(reports ?? []).map((g) => g.latest.id);
  const countsByReport = new Map<string, { classification: string; count: number }[]>();
  if (latestIds.length > 0) {
    const { data: items } = await supabase
      .from("report_items")
      .select("report_id, classification")
      .in("report_id", latestIds)
      .not("classification", "in", "(insufficient_data,cause_unconfirmed)")
      .returns<{ report_id: string; classification: string | null }[]>();
    const acc = new Map<string, Map<string, number>>();
    for (const it of items ?? []) {
      if (!it.classification) continue;
      const m = acc.get(it.report_id) ?? new Map<string, number>();
      m.set(it.classification, (m.get(it.classification) ?? 0) + 1);
      acc.set(it.report_id, m);
    }
    for (const [reportId, m] of acc) {
      countsByReport.set(
        reportId,
        [...m.entries()]
          .map(([classification, count]) => ({ classification, count }))
          .sort(
            (a, b) => severityOf(b.classification).rank - severityOf(a.classification).rank,
          ),
      );
    }
  }

  return (
    <>
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="font-mono-cli text-base text-il-navy">~ filed by the desk</div>
      <h1 className="mt-1 text-3xl font-bold text-il-navy">Reports</h1>
      <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">
        The desk files a fresh edition each evening it finds drops. The latest
        sits on top; earlier editions stay underneath. Open any edition for its
        ranked table and the sources behind every score.
      </p>

      {!reports?.length ? (
        <p className="mt-10 text-base text-muted-foreground">
          No reports filed yet. The desk files automatically on its
          schedule; the first one can also be kicked off from Setup.
        </p>
      ) : (
        <div className="mt-8 space-y-8">
          {groupByDesk(reports).map(({ agentName, latest, previous }) => {
            const meta = agentRegistry.get(agentName as AgentName);
            const color = MODULE_COLORS[agentName as AgentName] ?? "#6b7280";
            return (
              <section key={agentName}>
                <div className="mb-2 flex items-center gap-2 font-mono-cli text-base text-il-navy">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  ~ {meta?.displayName ?? agentName}
                </div>

                <Link
                  href={`/reports/${latest.id}`}
                  className="card-cli card-cli-module block px-5 py-4"
                  style={{ "--module-color": color } as React.CSSProperties}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="text-base font-bold text-il-navy">
                      Latest report
                    </div>
                    <div className="font-mono-cli text-sm text-muted-foreground">
                      {humanizeDateTime(latest.generated_at)}
                    </div>
                  </div>
                  {(countsByReport.get(latest.id)?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {countsByReport.get(latest.id)!.map((c) => (
                        <span key={c.classification} className="flex items-center gap-1.5">
                          <span className="font-mono-cli text-sm text-il-navy">
                            {c.count}×
                          </span>
                          <ClassificationChip classification={c.classification} />
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {firstSentences(stripInlineMarkdown(latest.summary_markdown))}
                  </p>
                </Link>

                {previous.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-mono-cli text-sm text-muted-foreground hover:text-il-orange">
                      ~ {previous.length} previous edition
                      {previous.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {previous.map((r) => (
                        <li key={r.id}>
                          <Link
                            href={`/reports/${r.id}`}
                            className="card-cli block px-5 py-3"
                          >
                            <div className="flex items-baseline justify-between gap-4">
                              <p className="line-clamp-1 min-w-0 text-base text-muted-foreground">
                                {firstSentences(
                                  stripInlineMarkdown(r.summary_markdown),
                                )}
                              </p>
                              <span className="shrink-0 font-mono-cli text-sm text-muted-foreground">
                                {humanizeDateTime(r.generated_at)}
                              </span>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Disclaimer />
    </main>
    </>
  );
}

function firstSentences(text: string, max = 220): string {
  const flat = text.split("\n").filter((l) => l.trim().length > 0)[0] ?? "";
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Group the (already newest-first) report list by desk: each desk shows its
 * latest edition prominently with prior editions collapsed — successive runs
 * are versions of one publication, not separate publications, and a flat list
 * of near-identical cards read as a bug. Desks order by their latest filing.
 */
function groupByDesk(reports: ReportRow[]): Array<{
  agentName: string;
  latest: ReportRow;
  previous: ReportRow[];
}> {
  const groups = new Map<string, ReportRow[]>();
  for (const r of reports) {
    const arr = groups.get(r.agent_name) ?? [];
    arr.push(r);
    groups.set(r.agent_name, arr);
  }
  return [...groups.entries()].map(([agentName, rows]) => ({
    agentName,
    latest: rows[0],
    previous: rows.slice(1),
  }));
}
