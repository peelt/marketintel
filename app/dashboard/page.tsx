import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { agentRegistry } from "@/lib/agents/registry";
import {
  ClassificationChip,
  MODULE_COLORS,
  SiteHeader,
  Star,
} from "@/components/cli";
import {
  humanizeDateTime,
  humanizeSchedule,
  nextRunLabel,
  stripInlineMarkdown,
} from "@/lib/format";
import type { AgentName } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

/**
 * The dashboard answers one question: "what did the desk find, and is it
 * fresh?" — verdicts first, machinery last. Live desks render as signal cards
 * fed from their latest succeeded report; planned desks are a roadmap
 * footnote, never cards (a card that can't file a report isn't a product
 * surface). A status strip up top answers "is the machine alive?".
 */

interface LatestReport {
  id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
}

interface TopItem {
  rank: number;
  composite_score: number;
  classification: string | null;
  scoring_breakdown: { coverage?: number } | null;
  security: { ticker: string } | null;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedEmail(user.email)) {
    redirect("/login");
  }

  const liveAgents = agentRegistry.list().filter((a) => a.status === "live");
  const plannedAgents = agentRegistry
    .list()
    .filter((a) => a.status === "planned" && a.name !== "energy"); // energy deprioritised

  // All reads via the RLS-scoped client (entitled-read policies).
  const [latestReports, freshness, securitiesCount] = await Promise.all([
    Promise.all(
      liveAgents.map(async (agent) => {
        const { data } = await supabase
          .from("reports")
          .select(
            "id, agent_name, generated_at, summary_markdown, agent_runs!inner(status)",
          )
          .eq("agent_name", agent.name)
          .eq("agent_runs.status", "succeeded")
          .order("generated_at", { ascending: false })
          .limit(1)
          .returns<LatestReport[]>();
        return { agent, report: data?.[0] ?? null };
      }),
    ),
    supabase
      .from("price_snapshots")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle<{ snapshot_date: string }>(),
    supabase.from("securities").select("*", { count: "exact", head: true }),
  ]);

  // Top classified names for each latest report (for the verdict chips).
  const topItemsByReport = new Map<string, TopItem[]>();
  await Promise.all(
    latestReports
      .filter((r) => r.report)
      .map(async ({ report }) => {
        const { data } = await supabase
          .from("report_items")
          .select(
            "rank, composite_score, classification, scoring_breakdown, security:securities(ticker)",
          )
          .eq("report_id", report!.id)
          .neq("classification", "insufficient_data")
          .order("rank", { ascending: true })
          .limit(3)
          .returns<TopItem[]>();
        topItemsByReport.set(report!.id, data ?? []);
      }),
  );

  const pricesAsOf = freshness.data?.snapshot_date ?? null;
  const nextRuns = liveAgents
    .map((a) => ({ a, next: nextRunLabel(a.schedule) }))
    .filter((x) => x.next);

  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono-cli text-base text-il-navy">~ the desk</div>
            <h1 className="mt-1 text-3xl font-bold text-il-navy">Dashboard</h1>
          </div>
          <form action={signOut}>
            <button type="submit" className="btn-cli-outline btn-cli-sm">
              sign out
            </button>
          </form>
        </div>

        {/* Status strip — is the machine alive? */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border-2 border-border bg-il-tint px-4 py-3 font-mono-cli text-base text-il-navy">
          <span>
            prices to{" "}
            <strong>
              {pricesAsOf
                ? new Date(pricesAsOf).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                  })
                : "—"}
            </strong>
          </span>
          <span>
            <strong>{securitiesCount.count ?? 0}</strong> securities tracked
          </span>
          {nextRuns.map(({ a, next }) => (
            <span key={a.name} className="text-muted-foreground">
              next {a.displayName.split(" ")[0].toLowerCase()}: {next}
            </span>
          ))}
        </div>

        {/* Latest signals — one card per LIVE desk, fed from its latest report */}
        <section className="mt-8">
          <div className="font-mono-cli text-base text-il-navy">~ latest signals</div>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {latestReports.map(({ agent, report }) => {
              const top = report ? (topItemsByReport.get(report.id) ?? []) : [];
              const headline = report
                ? stripInlineMarkdown(report.summary_markdown).split(". ")[0]
                : null;
              return (
                <Link
                  key={agent.name}
                  href={report ? `/reports/${report.id}` : "/reports"}
                  className="card-cli card-cli-module block p-6"
                  style={
                    {
                      "--module-color": MODULE_COLORS[agent.name as AgentName],
                    } as React.CSSProperties
                  }
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="text-lg font-bold text-il-navy">
                      {agent.displayName}
                    </div>
                    <div className="font-mono-cli text-sm text-muted-foreground">
                      {report
                        ? `filed ${humanizeDateTime(report.generated_at)}`
                        : "no report yet"}
                    </div>
                  </div>

                  {report ? (
                    <>
                      <p className="mt-3 text-base leading-relaxed text-foreground">
                        {headline}.
                      </p>
                      {top.length > 0 && (
                        <ul className="mt-4 space-y-2">
                          {top.map((item) => (
                            <li
                              key={item.rank}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="font-mono-cli text-base text-il-navy">
                                {item.security?.ticker ?? "—"}
                                <span className="ml-2 text-muted-foreground">
                                  {item.composite_score.toFixed(1)}
                                </span>
                              </span>
                              {item.classification && (
                                <ClassificationChip
                                  classification={item.classification}
                                />
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                      First report files automatically —{" "}
                      {humanizeSchedule(agent.schedule)}.
                    </p>
                  )}

                  <div className="mt-4 flex items-baseline justify-between font-mono-cli text-sm text-muted-foreground">
                    <span>runs {humanizeSchedule(agent.schedule)}</span>
                    <span className="text-il-accent">
                      {report ? "open report →" : "all reports →"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="mt-3 font-mono-cli text-sm text-muted-foreground">
            ~ roadmap:{" "}
            {plannedAgents.map((a) => a.displayName.toLowerCase()).join(" · ")}
          </p>
        </section>

        <hr className="divider-cli my-10" />

        <section className="grid gap-4 sm:grid-cols-3">
          <Link href="/reports" className="card-cli block p-6">
            <div className="font-mono-cli text-base">
              <Star /> <span className="font-bold text-il-navy">reports</span>
            </div>
            <p className="mt-2 text-base text-muted-foreground">
              Every filed report — rankings, verdicts and the evidence behind
              them.
            </p>
          </Link>
          <Link href="/dashboard/ops" className="card-cli block p-6">
            <div className="font-mono-cli text-base">
              <Star /> <span className="font-bold text-il-navy">setup</span>
            </div>
            <p className="mt-2 text-base text-muted-foreground">
              One-time setup and manual re-runs. Day to day, everything runs on
              schedule by itself.
            </p>
          </Link>
          <Link href="/dashboard/diagnostics" className="card-cli block p-6">
            <div className="font-mono-cli text-base">
              <Star /> <span className="font-bold text-il-navy">data health</span>
            </div>
            <p className="mt-2 text-base text-muted-foreground">
              Source readiness and row counts. UK fundamentals are a known gap
              on current sources.
            </p>
          </Link>
        </section>
      </main>
    </>
  );
}

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
