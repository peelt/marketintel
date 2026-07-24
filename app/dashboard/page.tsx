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
} from "@/lib/format";
import { deskSignalLine } from "@/lib/reports/desk-summary";
import type { DeskDelta } from "@/lib/reports/desk-deltas";
import { loadDeskCards } from "@/lib/reports/dashboard-data";
import { loadReactionFeed } from "@/lib/reports/reaction-feed";
import { ExperimentalNotice } from "@/components/experimental-notice";
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
        const portfolio = await loadDefaultPortfolio(supabase, user.id);
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

  return (
    <>
      <SiteHeader active="dashboard" userEmail={user.email} isOwner={isOwner} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div>
          <div className="font-mono-cli text-base text-il-navy">~ the desk</div>
          <h1 className="mt-1 text-3xl font-bold text-il-navy">Dashboard</h1>
          <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">
            Investorlogical runs a team of specialist AI research desks. Each
            screens part of the market on a fixed schedule and files ranked,
            evidence-backed reports against a scoring framework you can inspect
            in full. Below: your portfolio first, then each desk&apos;s latest
            findings and when it next runs — open any card for the report and
            the evidence behind every score.
          </p>
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
              const classified = report
                ? (classifiedByReport.get(report.id) ?? [])
                : [];
              const top = classified.slice(0, 3);
              const signal = deskSignalLine(classified);
              const delta = deskDeltas.get(agent.name);
              // Reaction is the perishable desk — rendered as a rolling last-48h
              // drop feed rather than the latest edition.
              const isReaction = agent.name === "reaction";
              const reactionDrops = reactionFeed.drops.slice(0, 3);
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
                      {isReaction
                        ? reactionFeed.lastScreenedAt
                          ? `last screened ${humanizeDateTime(reactionFeed.lastScreenedAt)}`
                          : "no runs yet"
                        : report
                          ? `filed ${humanizeDateTime(report.generated_at)}`
                          : "no report yet"}
                    </div>
                  </div>

                  {isReaction ? (
                    reactionFeed.drops.length > 0 ? (
                      <>
                        <p className="mt-3 font-mono-cli text-base text-il-navy">
                          {reactionFeed.drops.length} drop
                          {reactionFeed.drops.length === 1 ? "" : "s"} · last 48h
                        </p>
                        <ul className="mt-4 space-y-2">
                          {reactionDrops.map((d) => (
                            <li
                              key={d.securityId}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="min-w-0 truncate font-mono-cli text-base text-il-navy">
                                {d.ticker}
                                <span className="ml-2 text-muted-foreground">
                                  {compositeDisplay(d.composite, d.coverage ?? undefined)}
                                </span>
                              </span>
                              {d.classification && (
                                <ClassificationChip classification={d.classification} />
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                        No sharp drops screened in the last 48 hours — the market
                        has been calm. Fresh drops appear here the evening they
                        happen.
                      </p>
                    )
                  ) : report ? (
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
