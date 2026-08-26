import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { Disclaimer } from "@/components/disclaimer";
import { MODULE_COLORS } from "@/components/cli";
import {
  editionListLine,
  firstSentences,
  formatPriceDate,
  humanizeDateTime,
  pluralizeCounts,
  stripInlineMarkdown,
} from "@/lib/format";

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
                      Latest edition —{" "}
                      {formatPriceDate(latest.generated_at.slice(0, 10))}
                    </div>
                    <div className="font-mono-cli text-sm text-muted-foreground">
                      filed {humanizeDateTime(latest.generated_at)}
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {firstSentences(stripInlineMarkdown(pluralizeCounts(latest.summary_markdown)))}
                  </p>
                </Link>

                {/* Previous editions, VISIBLE — date first, since "the one
                    from Tuesday" is how a reader looks for an edition. Only
                    the long tail collapses. */}
                {previous.length > 0 && (
                  <div className="card-cli mt-2 p-0">
                    <ul>
                      {previous.slice(0, VISIBLE_PREVIOUS).map((r) => (
                        <li key={r.id} className="border-t border-border first:border-t-0">
                          <Link
                            href={`/reports/${r.id}`}
                            className="flex items-baseline gap-4 px-5 py-2.5 hover:bg-il-tint/60"
                          >
                            <span className="shrink-0 font-mono-cli text-sm font-bold text-il-navy">
                              {formatPriceDate(r.generated_at.slice(0, 10))}
                            </span>
                            <span className="line-clamp-1 min-w-0 text-sm text-muted-foreground">
                              {firstSentences(
                                stripInlineMarkdown(editionListLine(r.summary_markdown)),
                              )}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {previous.length > VISIBLE_PREVIOUS && (
                      <details>
                        <summary className="cursor-pointer border-t border-border px-5 py-2.5 font-mono-cli text-sm text-muted-foreground marker:content-none hover:text-il-orange">
                          ~ {previous.length - VISIBLE_PREVIOUS} older edition
                          {previous.length - VISIBLE_PREVIOUS === 1 ? "" : "s"}
                        </summary>
                        <ul>
                          {previous.slice(VISIBLE_PREVIOUS).map((r) => (
                            <li key={r.id} className="border-t border-border">
                              <Link
                                href={`/reports/${r.id}`}
                                className="flex items-baseline gap-4 px-5 py-2.5 hover:bg-il-tint/60"
                              >
                                <span className="shrink-0 font-mono-cli text-sm font-bold text-il-navy">
                                  {formatPriceDate(r.generated_at.slice(0, 10))}
                                </span>
                                <span className="line-clamp-1 min-w-0 text-sm text-muted-foreground">
                                  {firstSentences(
                                    stripInlineMarkdown(editionListLine(r.summary_markdown)),
                                  )}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
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

/** How many previous editions stay visible before the list collapses. */
const VISIBLE_PREVIOUS = 12;

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
