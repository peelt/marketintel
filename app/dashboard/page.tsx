import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isEntitledEmail } from "@/lib/auth/entitlement";
import { isOwnerEmail } from "@/lib/auth/allowlist";
import { agentRegistry } from "@/lib/agents/registry";
import {
  ClassificationChip,
  MODULE_COLORS,
  SiteHeader,
  Star,
} from "@/components/cli";
import {
  changeColor,
  compositeDisplay,
  dayChangeFraction,
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
  humanizeDateTime,
  humanizeSchedule,
  nextRunLabel,
  securityDisplayLabel,
  stripInlineMarkdown,
} from "@/lib/format";
import { loadDefaultPortfolio, loadHeldNames } from "@/lib/holdings/data";
import { loadPortfolioIntel } from "@/lib/holdings/intel";
import { fetchRates } from "@/lib/holdings/fx";
import {
  portfolioTotals,
  requiredRatePairs,
  valueHolding,
} from "@/lib/holdings/valuation";
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
  security: { ticker: string; name: string | null } | null;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isEntitledEmail(user.email))) {
    redirect("/login");
  }
  // Setup and Data health are owner-only admin surfaces (both pages redirect
  // non-owners) — so they must not appear as nav links or cards for everyday
  // users, who'd only bounce off them.
  const isOwner = isOwnerEmail(user.email);

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
            "rank, composite_score, classification, scoring_breakdown, security:securities(ticker, name)",
          )
          .eq("report_id", report!.id)
          // Exclude both insufficient_data AND cause_unconfirmed: the report
          // page deliberately pulls cause_unconfirmed names OUT of the ranking
          // (an overshoot claim without a news grade is unsupported), so the
          // dashboard must not promote them to headline verdicts.
          .not("classification", "in", "(insufficient_data,cause_unconfirmed)")
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

  // Portfolio summary — a compact block on the desk dashboard (the full
  // surface lives at /portfolio). Held names carrying an active desk verdict
  // are the highest-value thing to surface here.
  const portfolio = await loadDefaultPortfolio(supabase, user.id);
  const [held, intel] = portfolio
    ? await Promise.all([
        loadHeldNames(supabase, portfolio.id),
        loadPortfolioIntel(supabase, portfolio.id),
      ])
    : [[], { items: [], attentionCount: 0, health: { covered: 0, flagged: 0, byClassification: [] } }];
  const base = portfolio?.base_currency ?? "GBP";
  const rates =
    held.length > 0
      ? await fetchRates(requiredRatePairs(held, base))
      : new Map<string, number>();
  const portfolioTotal = portfolioTotals(
    held.map((h) =>
      valueHolding(
        {
          quantity: h.quantity,
          latestClose: h.latestClose,
          priceCurrency: h.priceCurrency,
          previousClose: h.previousClose,
        },
        base,
        rates,
      ),
    ),
  );
  // Names with a fresh flag/worsening this run — the highest-value alert.
  const attentionItems = intel.items.filter((i) => i.delta.attention);

  return (
    <>
      <SiteHeader active="dashboard" userEmail={user.email} isOwner={isOwner} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div>
          <div className="font-mono-cli text-base text-il-navy">~ the desk</div>
          <h1 className="mt-1 text-3xl font-bold text-il-navy">Dashboard</h1>
        </div>

        {/* The desk grid — My Portfolio leads (YOUR money first), then one
            card per LIVE desk. Six cards: two rows of three on desktop. */}
        <section className="mt-8">
          <div className="font-mono-cli text-base text-il-navy">~ latest signals</div>
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Link
              href="/portfolio"
              className="card-cli card-cli-module block p-6"
              style={{ "--module-color": "#00b5e2" } as React.CSSProperties}
            >
              <div className="flex items-baseline justify-between gap-4">
                <div className="text-lg font-bold text-il-navy">My Portfolio</div>
                <div className="font-mono-cli text-sm text-muted-foreground">
                  {held.length > 0
                    ? `${held.length} holding${held.length === 1 ? "" : "s"}`
                    : "empty"}
                </div>
              </div>

              {held.length > 0 ? (
                <>
                  <p className="mt-3 text-base leading-relaxed text-foreground">
                    <span className="font-bold text-il-navy">
                      {formatMoney(portfolioTotal.baseValue, base)}
                    </span>
                    <span
                      className="ml-2 font-bold"
                      style={{ color: changeColor(portfolioTotal.baseDayChange) }}
                    >
                      {formatSignedMoney(portfolioTotal.baseDayChange, base)}
                      {dayChangeFraction(
                        portfolioTotal.baseValue,
                        portfolioTotal.baseDayChange,
                      ) !== null && (
                        <>
                          {" "}
                          (
                          {formatSignedPercent(
                            dayChangeFraction(
                              portfolioTotal.baseValue,
                              portfolioTotal.baseDayChange,
                            ),
                          )}
                          )
                        </>
                      )}
                    </span>
                  </p>
                  {attentionItems.length > 0 ? (
                    <ul className="mt-4 space-y-2">
                      {[...new Set(attentionItems.map((i) => i.ticker))]
                        .slice(0, 3)
                        .map((ticker) => (
                          <li
                            key={ticker}
                            className="flex items-center gap-2 font-mono-cli text-base"
                          >
                            <span style={{ color: "#ee1d23" }}>⚠</span>
                            <span className="font-bold text-il-navy">{ticker}</span>
                            <span className="text-muted-foreground">
                              changed — needs a look
                            </span>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-base text-muted-foreground">
                      No changes on your names since the last runs.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                  Add the shares you hold to see them valued and get every
                  desk&apos;s verdicts filtered to your names.
                </p>
              )}

              <div className="mt-4 flex items-baseline justify-between font-mono-cli text-sm text-muted-foreground">
                <span>valued daily, {base}</span>
                <span className="text-il-accent">
                  {held.length > 0 ? "manage holdings →" : "add holdings →"}
                </span>
              </div>
            </Link>

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
                              <span className="min-w-0 truncate font-mono-cli text-base text-il-navy">
                                {/* CIK placeholders (pre-listing IPO issuers)
                                    display as the company name — a raw CIK
                                    means nothing to a reader. */}
                                {item.security
                                  ? securityDisplayLabel(item.security)
                                  : "—"}
                                <span className="ml-2 text-muted-foreground">
                                  {/* Missing ≠ zero — shared rule with the
                                      report page so the two never disagree. */}
                                  {compositeDisplay(
                                    item.composite_score,
                                    item.scoring_breakdown?.coverage,
                                  )}
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
          {plannedAgents.length > 0 && (
            <p className="mt-3 font-mono-cli text-sm text-muted-foreground">
              ~ roadmap:{" "}
              {plannedAgents.map((a) => a.displayName.toLowerCase()).join(" · ")}
            </p>
          )}
        </section>

        <hr className="divider-cli my-10" />

        {/* System status — quiet telemetry, deliberately below the fold */}
        <p className="mb-6 font-mono-cli text-sm text-muted-foreground">
          ~ prices to{" "}
          {pricesAsOf
            ? new Date(pricesAsOf).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
              })
            : "—"}{" "}
          · {securitiesCount.count ?? 0} securities tracked
          {nextRuns.map(({ a, next }) => (
            <span key={a.name}>
              {" "}
              · next {a.displayName.split(" ")[0].toLowerCase()}: {next}
            </span>
          ))}
        </p>

        <section
          className={`grid gap-4 ${isOwner ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
        >
          <Link href="/reports" className="card-cli block p-6">
            <div className="font-mono-cli text-base">
              <Star /> <span className="font-bold text-il-navy">reports</span>
            </div>
            <p className="mt-2 text-base text-muted-foreground">
              Every filed report — rankings, verdicts and the evidence behind
              them.
            </p>
          </Link>
          <Link href="/portfolio" className="card-cli block p-6">
            <div className="font-mono-cli text-base">
              <Star /> <span className="font-bold text-il-navy">portfolio</span>
            </div>
            <p className="mt-2 text-base text-muted-foreground">
              Your holdings, valued daily, and what changed on them since the
              last run.
            </p>
          </Link>
          {/* Owner-only admin surfaces — hidden from everyday users, who'd only
              be redirected away. */}
          {isOwner && (
            <Link href="/dashboard/diagnostics" className="card-cli block p-6">
              <div className="font-mono-cli text-base">
                <Star />{" "}
                <span className="font-bold text-il-navy">data health</span>
              </div>
              <p className="mt-2 text-base text-muted-foreground">
                Source readiness and row counts. UK fundamentals are a known gap
                on current sources.
              </p>
            </Link>
          )}
        </section>
      </main>
    </>
  );
}
