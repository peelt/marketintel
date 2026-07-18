import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEntitledEmail } from "@/lib/auth/entitlement";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { Disclaimer } from "@/components/disclaimer";
import { MODULE_COLORS, SiteHeader } from "@/components/cli";
import { humanizeDateTime, stripInlineMarkdown } from "@/lib/format";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isEntitledEmail(user.email))) redirect("/login");

  // Inner-join on the run and filter to succeeded — failed or half-persisted
  // runs must never render as legitimate reports.
  const { data: reports } = await supabase
    .from("reports")
    .select("id, agent_name, generated_at, summary_markdown, agent_runs!inner(status)")
    .eq("agent_runs.status", "succeeded")
    .order("generated_at", { ascending: false })
    .limit(50)
    .returns<ReportRow[]>();

  return (
    <>
    <SiteHeader active="reports" userEmail={user.email} />
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="font-mono-cli text-base text-il-navy">~ filed by the desk</div>
      <h1 className="mt-1 text-3xl font-bold text-il-navy">Reports</h1>

      {!reports?.length ? (
        <p className="mt-10 text-base text-muted-foreground">
          No reports filed yet. The desks file automatically on their
          schedules; the first ones can also be kicked off from Setup.
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
                  <p className="mt-1.5 line-clamp-2 text-base leading-relaxed text-muted-foreground">
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
