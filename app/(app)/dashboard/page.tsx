import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { agentRegistry } from "@/lib/agents/registry";
import {
  ClassificationChip,
  MODULE_COLORS,
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
} from "@/lib/format";
import { deskSignalLine } from "@/lib/reports/desk-summary";
import type { DeskDelta } from "@/lib/reports/desk-deltas";
import { loadDeskCards } from "@/lib/reports/dashboard-data";
import { loadReactionFeed } from "@/lib/reports/reaction-feed";
import { ExperimentalNotice } from "@/components/experimental-notice";
import { ReactionAnalyseForm } from "@/components/reaction-analyse-form";
import { loadDefaultPortfolio, loadHeldNames } from "@/lib/holdings/data";
import { loadPortfolioIntel, type PortfolioIntel } from "@/lib/holdings/intel";
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

interface TopItem {
  rank: number;
  composite_score: number;
  classification: string | null;
  scoring_breakdown: { coverage?: number } | null;
  security: { ticker: string; name: string | null } | null;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { userId, isOwner } = await getSessionContext();
  if (!userId) redirect("/login");

  // Setup and Data health are owner-only admin surfaces (both pages redirect
  // non-owners) — so they must not appear as cards for everyday users, who'd
  // only bounce off them. (The nav's owner links live in the app shell.)
  const liveAgents = agentRegistry.list().filter((a) => a.status === "live");
  const plannedAgents = agentRegistry
    .list()
    .filter((a) => a.status === "planned" && a.name !== "energy"); // energy deprioritised

  // Everything below is independent, so run it CONCURRENTLY rather than in a
  // chain of round-trips: the (cached, non-user-specific) desk cards, the
  // user's portfolio bundle, and the two telemetry reads. This — plus folding
  // the desk reads from ~20 queries into ~6 cached ones, and caching the
  // entitlement read — is the dashboard responsiveness fix.
  const emptyIntel: PortfolioIntel = {
    items: [],
    attentionCount: 0,
    health: { covered: 0, flagged: 0, byClassification: [] },
  };
  const [deskCards, reactionFeed, portfolioBundle, freshness, securitiesCount] =
    await Promise.all([
      loadDeskCards(
        supabase,
        liveAgents.map((a) => a.name),
      ),
      // Reaction is perishable — its card is a rolling last-48h drop feed, not
      // the "latest edition", so stale drops age out and a quiet market reads
      // honestly instead of parading days-old drops.
      loadReactionFeed(supabase),
      (async () => {
        const portfolio = await loadDefaultPortfolio(supabase, userId);
        const [held, intel] = portfolio
          ? await Promise.all([
              loadHeldNames(supabase, portfolio.id),
              loadPortfolioIntel(supabase, portfolio.id),
            ])
          : [[], emptyIntel];
        const base = portfolio?.base_currency ?? "GBP";
        const rates =
          held.length > 0
            ? await fetchRates(requiredRatePairs(held, base))
            : new Map<string, number>();
        return { held, intel, base, rates };
      })(),
      supabase
        .from("price_snapshots")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle<{ snapshot_date: string }>(),
      supabase.from("securities").select("*", { count: "exact", head: true }),
    ]);

  const { held, intel, base, rates } = portfolioBundle;

  // Reconstruct the shapes the render already uses, from the desk cards.
  const latestReports = liveAgents.map((a) => ({
    agent: a,
    report: deskCards.find((c) => c.agentName === a.name)?.report ?? null,
  }));
  const classifiedByReport = new Map<string, TopItem[]>();
  const deskDeltas = new Map<string, DeskDelta>();
  for (const c of deskCards) {
    if (c.report) classifiedByReport.set(c.report.id, c.classified);
    if (c.delta) deskDeltas.set(c.agentName, c.delta);
  }

  const pricesAsOf = freshness.data?.snapshot_date ?? null;
  const nextRuns = liveAgents
    .map((a) => ({ a, next: nextRunLabel(a.schedule) }))
    .filter((x) => x.next);

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

  // Product hierarchy: Reaction IS the product — it gets a full-width band
  // up top (rolling 48h feed + on-demand analysis); newsroomReports is empty
  // since the 2026-07 desk retirement but the plumbing stays for a revival.
  const reactionMeta = agentRegistry.get("reaction")!;
  const reactionReport =
    latestReports.find((r) => r.agent.name === "reaction")?.report ?? null;
  const newsroomReports = latestReports.filter(
    (r) => r.agent.name !== "reaction",
  );
  const feedDrops = reactionFeed.drops.slice(0, 6);
  // The portfolio card is currently the only card in "your names". Drives its
  // layout: alone it goes full width, in company it returns to the grid.
  const soloPortfolio = newsroomReports.length === 0;

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div>
          <div className="font-mono-cli text-base text-il-navy">~ the desk</div>
          <h1 className="mt-1 text-3xl font-bold text-il-navy">Dashboard</h1>
          <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">
            The Reaction desk screens for sharp drops every evening and grades
            each one on whether the move looks earned or an overshoot — with
            every source cited — and you can put a name in front of it on
            demand. Add your holdings and it watches your names too. Open any
            report for the verdict and the evidence behind every score.
          </p>
        </div>

        {/* The reaction band — the hero desk, full width. Left: the rolling
            48h drop feed (perishable by construction — stale drops age out).
            Right: the on-demand "analyse a drop" interaction. */}
        <section className="mt-8">
          <div className="font-mono-cli text-base text-il-navy">
            ~ the reaction desk
          </div>
          <div
            className="card-cli card-cli-module mt-3 p-6"
            style={
              {
                "--module-color": MODULE_COLORS["reaction"],
              } as React.CSSProperties
            }
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <div className="text-lg font-bold text-il-navy">
                  {reactionMeta.displayName}
                </div>
                <div className="font-mono-cli text-sm text-muted-foreground">
                  ~ {reactionMeta.cadence}
                </div>
              </div>
              <div className="font-mono-cli text-sm text-muted-foreground">
                {reactionFeed.lastScreenedAt
                  ? `last screened ${humanizeDateTime(reactionFeed.lastScreenedAt)}`
                  : "no runs yet"}
              </div>
            </div>

            <div className="mt-4 grid gap-8 lg:grid-cols-[7fr_5fr]">
              <div>
                {feedDrops.length > 0 ? (
                  <>
                    <p className="font-mono-cli text-base text-il-navy">
                      {reactionFeed.drops.length} drop
                      {reactionFeed.drops.length === 1 ? "" : "s"} · last 48h
                    </p>
                    <ul className="mt-3 space-y-2">
                      {feedDrops.map((d) => (
                        <li key={d.securityId}>
                          <Link
                            href={`/reports/${d.reportId}`}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="min-w-0 truncate font-mono-cli text-base text-il-navy">
                              {d.ticker}
                              <span className="ml-2 text-muted-foreground">
                                {compositeDisplay(
                                  d.composite,
                                  d.coverage ?? undefined,
                                )}
                              </span>
                            </span>
                            {d.classification && (
                              <ClassificationChip
                                classification={d.classification}
                              />
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-base leading-relaxed text-muted-foreground">
                    No sharp drops screened in the last 48 hours — the market
                    has been calm. Fresh drops appear here the evening they
                    happen, or put a name in front of the desk now.
                  </p>
                )}
                <div className="mt-4 font-mono-cli text-sm text-muted-foreground">
                  {nextRunLabel(reactionMeta.schedule) && (
                    <span>next {nextRunLabel(reactionMeta.schedule)} · </span>
                  )}
                  {reactionReport ? (
                    <Link
                      href={`/reports/${reactionReport.id}`}
                      className="text-il-accent"
                    >
                      open latest report →
                    </Link>
                  ) : (
                    <Link href="/reports" className="text-il-accent">
                      all reports →
                    </Link>
                  )}
                </div>
              </div>

              <div className="lg:border-l-2 lg:border-border lg:pl-8">
                <ReactionAnalyseForm />
              </div>
            </div>
          </div>
        </section>

        {/* My Portfolio — YOUR money first. The weekly specialist desks that
            used to fill this grid were retired in the 2026-07 scope reduction,
            so newsroomReports is empty until a desk revival. A lone card in a
            three-column grid reads as a broken layout (one narrow card, two
            columns of void), so when it IS alone the card goes full width and
            splits its content the way the reaction band above does. Revive a
            desk and the multi-card grid comes back on its own. */}
        <section className="mt-8">
          <div className="font-mono-cli text-base text-il-navy">~ your names</div>
          <div
            className={`mt-3 grid gap-4 ${soloPortfolio ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}
          >
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

              <div
                className={
                  soloPortfolio ? "mt-4 grid gap-8 lg:grid-cols-[7fr_5fr]" : ""
                }
              >
                <div>
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
                    Add the shares you hold to see them valued daily and get the
                    desk&apos;s verdicts on your names when they move.
                  </p>
                )}
                </div>

                {/* Wide layout: the footer becomes a right-hand column with
                    room to say what the page actually does, mirroring the
                    reaction band's action column. Narrow layout: the original
                    one-line footer. */}
                {soloPortfolio ? (
                  <div className="mt-4 lg:mt-0 lg:border-l-2 lg:border-border lg:pl-8">
                    <p className="font-mono-cli text-base text-il-navy">
                      ~ {held.length > 0 ? "manage holdings" : "add holdings"}
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                      {held.length > 0
                        ? `Valued daily in ${base}. `
                        : "Purchase price is optional. "}
                      {held.length > 0 ? "Purchase price is" : "It is"} shown
                      for your own reference only — it never feeds a score, and
                      no verdict is tailored to what you hold.
                    </p>
                    <p className="mt-4 font-mono-cli text-sm text-il-accent">
                      {held.length > 0 ? "manage holdings →" : "add holdings →"}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 flex items-baseline justify-between font-mono-cli text-sm text-muted-foreground">
                    <span>valued daily, {base}</span>
                    <span className="text-il-accent">
                      {held.length > 0 ? "manage holdings →" : "add holdings →"}
                    </span>
                  </div>
                )}
              </div>
            </Link>

            {newsroomReports.map(({ agent, report }) => {
              const classified = report
                ? (classifiedByReport.get(report.id) ?? [])
                : [];
              const top = classified.slice(0, 3);
              const signal = deskSignalLine(classified);
              const delta = deskDeltas.get(agent.name);
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
                    <div>
                      <div className="text-lg font-bold text-il-navy">
                        {agent.displayName}
                      </div>
                      <div className="font-mono-cli text-sm text-muted-foreground">
                        ~ {agent.cadence}
                      </div>
                    </div>
                    <div className="font-mono-cli text-sm text-muted-foreground">
                      {report
                        ? `filed ${humanizeDateTime(report.generated_at)}`
                        : "no report yet"}
                    </div>
                  </div>

                  {report ? (
                    <>
                      {signal && (
                        <p className="mt-3 font-mono-cli text-base text-il-navy">
                          {signal}
                        </p>
                      )}
                      {delta && (
                        <p className="mt-1 font-mono-cli text-sm text-muted-foreground">
                          {delta.upgrades > 0 && (
                            <span style={{ color: "#22a87b" }}>
                              ↑{delta.upgrades} upgrade
                              {delta.upgrades === 1 ? "" : "s"}
                            </span>
                          )}
                          {delta.upgrades > 0 && delta.downgrades > 0 && " · "}
                          {delta.downgrades > 0 && (
                            <span style={{ color: "#ee1d23" }}>
                              ↓{delta.downgrades} downgrade
                              {delta.downgrades === 1 ? "" : "s"}
                            </span>
                          )}{" "}
                          since last edition
                        </p>
                      )}
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
                    <span>
                      {nextRunLabel(agent.schedule)
                        ? `next ${nextRunLabel(agent.schedule)}`
                        : `runs ${humanizeSchedule(agent.schedule)}`}
                    </span>
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
          <ExperimentalNotice className="mt-6" />
        </section>

        <hr className="divider-cli my-10" />

        {/* System status — engine telemetry, owner-only. An everyday reader
            doesn't need price-refresh dates or the securities row count; the
            per-desk "next run" already lives on each card above. */}
        {isOwner && (
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
        )}

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
                Price freshness, the verdict scorecard, source readiness and row
                counts — is the engine seeing today&apos;s market?
              </p>
            </Link>
          )}
        </section>
      </main>
    </>
  );
}
