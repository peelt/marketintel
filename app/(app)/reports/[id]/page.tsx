import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { Disclaimer } from "@/components/disclaimer";
import {
  ClassificationChip,
  CoverageBar,
  MODULE_COLORS,
} from "@/components/cli";
import {
  classificationLabel,
  compositeDisplay,
  confidenceWord,
  humanizeDateTime,
  securityDisplayLabel,
  securitySecondaryLabel,
} from "@/lib/format";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { CriteriaRadar } from "@/components/criteria-radar";
import { NewsEvidenceCard } from "@/components/news-evidence";
import { PriceChart, type PricePoint } from "@/components/price-chart";
import { MacroRead } from "@/components/macro-read";
import { extractDriverLine, parseMacroMemo } from "@/lib/reports/macro-memo";

export const dynamic = "force-dynamic";

/**
 * Report page, assembled from the STRUCTURED data the agent filed (ranks,
 * classifications, coverage, evidence) rather than its markdown essay —
 * conclusion first, ranking second, evidence third, prose last (collapsed).
 * Names with 0% coverage are collapsed to an honest exclusion note instead of
 * rendering as rows of dashes: the reader shouldn't pay for a sourcing gap.
 */

interface ReportRow {
  id: string;
  agent_run_id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
  body_markdown: string;
}

interface ReportItemRow {
  id: string;
  rank: number;
  security_id: string | null;
  composite_score: number;
  scoring_breakdown: {
    /** 0–1 share of framework weight that had data behind it. */
    coverage?: number;
    criteria?: Record<
      string,
      { score: number | null; signals: Record<string, number | null> }
    >;
  };
  verdict: string | null;
  classification: string | null;
  security: { ticker: string; exchange: string; name: string } | null;
}

/**
 * Composite for display. A below-floor composite computed from PARTIAL data is
 * real and shown with its coverage attached — but at 0% coverage there is no
 * data behind the number at all, so rendering "0.0" would fabricate a
 * worst-possible score (missing ≠ zero). Render "—" instead.
 */
function displayComposite(it: ReportItemRow): string {
  return compositeDisplay(it.composite_score, it.scoring_breakdown?.coverage);
}

function coverageOf(it: ReportItemRow): number {
  return it.scoring_breakdown?.coverage ?? 0;
}

/**
 * Honest one-liner for an empty criterion — a glass-box product never shows
 * unexplained absence. The known structural gap (no free UK fundamentals
 * source) gets named; everything else states the general truth without
 * inventing specifics.
 */
function noDataReason(criterionKey: string, exchange: string | null): string {
  const fundamentalsKeys = [
    "balance_sheet",
    "coverage_and_sustainability",
    "balance_sheet_resilience",
  ];
  if (exchange === "LSE" && fundamentalsKeys.includes(criterionKey)) {
    return "UK fundamentals aren't served by the current data sources — a known gap. The weight redistributed to the other criteria.";
  }
  return "No active source had this input this run; its weight redistributed to the other criteria.";
}

interface EvidenceRow {
  id: string;
  report_item_id: string;
  evidence_type: string;
  source_table: string;
  source_text: string;
  weight: number;
  redistributable: boolean;
}

interface PriceHistoryRow {
  security_id: string;
  snapshot_date: string;
  close: number;
  currency: string | null;
}

interface RunRow {
  framework_id: string | null;
  framework: { version: number } | null;
  started_at: string;
  finished_at: string | null;
  status: string;
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { userId } = await getSessionContext();
  if (!userId) redirect("/login");
  const { data: report, error: reportErr } = await supabase
    .from("reports")
    .select(
      "id, agent_run_id, agent_name, generated_at, summary_markdown, body_markdown",
    )
    .eq("id", id)
    .maybeSingle<ReportRow>();
  // A read error must not masquerade as "not found" (404) — surface it.
  if (reportErr) throw new Error(`report load: ${reportErr.message}`);
  if (!report) notFound();
  // Retired desks' editions are withdrawn from the product (2026-07 scope
  // reduction) — the rows stay in the database, but a direct URL must not
  // keep serving content the list no longer offers.
  if (agentRegistry.get(report.agent_name as AgentName)?.status === "retired") {
    notFound();
  }

  const { data: run, error: runErr } = await supabase
    .from("agent_runs")
    .select(
      "framework_id, started_at, finished_at, status, framework:scoring_frameworks(version)",
    )
    .eq("id", report.agent_run_id)
    .maybeSingle<RunRow>();
  if (runErr) throw new Error(`report run load: ${runErr.message}`);

  // Invariant: a report whose run did not SUCCEED must never render its
  // ranked table, verdicts, or evidence — a half-persisted artefact would
  // read as a real report. (The list and dashboard already hide these; this
  // guards the directly-reachable URL.) Show an honest notice instead. A run
  // we couldn't load is treated the same way — we can't confirm success.
  const succeeded = run?.status === "succeeded";
  if (!succeeded) {
    const meta = agentRegistry.get(report.agent_name as AgentName);
    return (
      <>
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
          <Link
            href="/reports"
            className="font-mono-cli text-sm text-muted-foreground hover:text-il-orange"
          >
            ← reports
          </Link>
          <h1 className="mt-4 text-3xl font-bold text-il-navy">
            {meta?.displayName ?? report.agent_name}
          </h1>
          <p className="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-base text-amber-700">
            This report isn&apos;t available — its run{" "}
            {run ? (
              <>finished with status <strong>{run.status}</strong></>
            ) : (
              "record could not be loaded"
            )}
            , so nothing here is shown. Scored reports appear under{" "}
            <Link href="/reports" className="underline">
              reports
            </Link>{" "}
            once a run completes successfully.
          </p>
          <Disclaimer />
        </main>
      </>
    );
  }

  const { data: items, error: itemsErr } = await supabase
    .from("report_items")
    .select(
      "id, rank, security_id, composite_score, scoring_breakdown, verdict, classification, security:securities(ticker, exchange, name)",
    )
    .eq("report_id", report.id)
    .order("rank", { ascending: true })
    .returns<ReportItemRow[]>();
  // Don't let an errored items read render as a report with zero candidates
  // (indistinguishable from a genuinely empty one).
  if (itemsErr) throw new Error(`report items load: ${itemsErr.message}`);

  // Evidence + 1y price history for the evidence viewer — the whole point of
  // the architecture (I1/I4): every score defensible from its cited rows.
  const allItems = items ?? [];
  const itemIds = allItems.map((i) => i.id);
  const securityIds = allItems
    .map((i) => i.security_id)
    .filter((v): v is string => v !== null);

  const [{ data: evidence, error: evidenceErr }, { data: priceHistory }] =
    await Promise.all([
    itemIds.length
      ? supabase
          .from("evidence")
          .select(
            "id, report_item_id, evidence_type, source_table, source_text, weight, redistributable",
          )
          .in("report_item_id", itemIds)
          .order("weight", { ascending: false })
          .returns<EvidenceRow[]>()
      : Promise.resolve({ data: [] as EvidenceRow[], error: null }),
    securityIds.length
      ? // N candidates × ~250 sessions exceeds PostgREST's silent 1,000-row
        // cap — an unpaginated read here chopped the most RECENT months off
        // every chart (dates ascending, so the tail is what got cut), showing
        // a rising line under a verdict about a crash. Always paginate.
        fetchAllRows<PriceHistoryRow>(
          (from, to) =>
            supabase
              .from("price_snapshots")
              .select("security_id, snapshot_date, close, currency")
              .in("security_id", securityIds)
              .gte(
                "snapshot_date",
                new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
                  .toISOString()
                  .slice(0, 10),
              )
              .order("security_id", { ascending: true })
              .order("snapshot_date", { ascending: true })
              .range(from, to),
          "report price history",
        ).then((rows) => ({ data: rows }))
      : Promise.resolve({ data: [] as PriceHistoryRow[] }),
  ]);
  // Evidence is the glass-box promise — a report silently rendering WITHOUT
  // the rows behind its scores is worse than an error page. Surface it.
  if (evidenceErr) throw new Error(`report evidence load: ${evidenceErr.message}`);

  const evidenceByItem = new Map<string, EvidenceRow[]>();
  for (const ev of evidence ?? []) {
    const arr = evidenceByItem.get(ev.report_item_id) ?? [];
    arr.push(ev);
    evidenceByItem.set(ev.report_item_id, arr);
  }
  const pricesBySecurity = new Map<string, PriceHistoryRow[]>();
  for (const p of priceHistory ?? []) {
    const arr = pricesBySecurity.get(p.security_id) ?? [];
    arr.push(p);
    pricesBySecurity.set(p.security_id, arr);
  }

  const meta = agentRegistry.get(report.agent_name as AgentName);
  const moduleColor = MODULE_COLORS[report.agent_name as AgentName] ?? "#034566";
  // The Geopolitical desk is a hybrid: its body_markdown IS the macro read
  // (the memo), shown prominently ABOVE the table rather than collapsed at
  // the bottom like other desks' analyst notes.
  // The Geopolitical desk is a hybrid: its whole body IS the memo, so it
  // replaces the analyst note. Reaction EMBEDS a macro read (its "why did it
  // drop" backdrop) as one section of a longer report — same markdown shape,
  // same accordion render, but the analyst note still applies.
  const isMacroMemo = report.agent_name === "geopolitical";
  const hasMacroSection = isMacroMemo || report.agent_name === "reaction";

  // Partition: 0%-coverage names collapse to an exclusion note, and names
  // whose DEFINING evidence failed (reaction's news grade → cause_unconfirmed)
  // are pulled from the ranking into their own note — an overshoot claim
  // without news to weigh is unsupported. Everything else stays ranked
  // (below-floor partials sit at the bottom, by design).
  const unconfirmedItems = allItems.filter(
    (i) => i.classification === "cause_unconfirmed",
  );
  // A corporate action (split, consolidation, demerger) is not a fall at all,
  // so it can't be ranked for overshoot-ness — it gets its own note saying
  // what the price series was actually showing.
  const corporateActionItems = allItems.filter(
    (i) => i.classification === "corporate_action",
  );
  const rankedItems = allItems.filter(
    (i) =>
      coverageOf(i) > 0 &&
      i.classification !== "cause_unconfirmed" &&
      i.classification !== "corporate_action",
  );
  const excludedItems = allItems.filter(
    (i) => coverageOf(i) === 0 && i.classification !== "corporate_action",
  );

  const classified = rankedItems.filter(
    (i) => i.classification && i.classification !== "insufficient_data",
  );
  const classificationCounts = new Map<string, number>();
  for (const i of classified) {
    classificationCounts.set(
      i.classification!,
      (classificationCounts.get(i.classification!) ?? 0) + 1,
    );
  }
  const avgCoverage =
    rankedItems.length > 0
      ? rankedItems.reduce((sum, i) => sum + coverageOf(i), 0) / rankedItems.length
      : 0;

  // Parse the macro read into structured themes for the accordion render;
  // null (any other desk, no read this run, or an unparseable memo) falls back
  // to raw markdown for the hybrid desk so nothing is ever dropped.
  const parsedMemo = hasMacroSection
    ? parseMacroMemo(report.body_markdown)
    : null;

  return (
    <>
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header>
        <Link
          href="/reports"
          className="font-mono-cli text-sm text-muted-foreground hover:text-il-orange"
        >
          ← reports
        </Link>
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold text-il-navy">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: moduleColor }}
            />
            {meta?.displayName ?? report.agent_name}
          </h1>
          <div className="font-mono-cli text-base text-muted-foreground">
            {humanizeDateTime(report.generated_at)}
            {run?.framework?.version != null && (
              <> · framework v{run.framework.version}</>
            )}
          </div>
        </div>
        {/* What this desk covers — why these names and not others. Shown on
            every edition so the reader never has to guess the scope. */}
        {meta?.scope && (
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground">
            {meta.scope}
          </p>
        )}
      </header>

      {/* (Non-succeeded runs never reach here — they return the "not
          available" notice above, so no partial report can render.) */}

      {/* Macro read — the memo, shown above everything for the Geopolitical
          hybrid desk. Rendered as theme accordions (title + confidence + which-
          way-it-cuts visible, detail on expand) so the ranked table stays near
          the top. Falls back to raw markdown if the memo ever doesn't parse. */}
      {isMacroMemo &&
        (parsedMemo ? (
          <section className="card-cli mt-8 p-6">
            <MacroRead memo={parsedMemo} />
          </section>
        ) : (
          <section className="card-cli mt-8 p-6">
            <article className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {report.body_markdown}
              </ReactMarkdown>
            </article>
          </section>
        ))}

      {/* Verdict strip — the conclusion at a glance: how the run broke down by
          classification, plus average coverage. (The per-name verdicts live in
          the ranked table below; repeating the top three here was duplication.) */}
      {rankedItems.length > 0 && (
        <section className="card-cli mt-8 p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <span className="font-mono-cli text-base text-il-navy">
              {rankedItems.length} name{rankedItems.length === 1 ? "" : "s"} ranked
            </span>
            {[...classificationCounts.entries()].map(([cls, count]) => (
              <span key={cls} className="flex items-center gap-2">
                <span className="font-mono-cli text-base text-il-navy">{count}×</span>
                <ClassificationChip classification={cls} />
              </span>
            ))}
            <span className="ml-auto flex items-center gap-2 font-mono-cli text-base text-muted-foreground">
              avg coverage <CoverageBar coverage={avgCoverage} />
            </span>
          </div>
        </section>
      )}

      {/* Reaction's macro backdrop — what was moving prices when these names
          fell, so a drop reads as company-specific or as part of a wider move.
          Sits between the conclusion and the names: it explains the day, it
          doesn't rank it. COMPACT by default — rendered open it ran to a
          screen of market commentary between the conclusion and the names,
          burying what it was there to support. Silently absent when the read
          failed (the body still says so in the analyst note) — an empty
          backdrop is not a finding. */}
      {!isMacroMemo && parsedMemo && (
        <section className="card-cli mt-8 p-5">
          <MacroRead
            memo={parsedMemo}
            compact
            driverLine={extractDriverLine(report.summary_markdown)}
          />
        </section>
      )}

      {/* Ranked candidates — one scannable table whose rows OPEN into the
          evidence behind each score. (Previously this was two stacked lists
          repeating the same names; the ranking and its evidence are one thing,
          so they're one thing here.) */}
      {rankedItems.length > 0 && (
        <section className="mt-10">
          <div className="font-mono-cli text-base text-il-navy">~ ranked candidates</div>
          <p className="mt-1 text-base text-muted-foreground">
            Ranked by composite. Open any row to see the framework read behind
            its score — criteria, price, and every cited source.
          </p>
          <div className="card-cli mt-3 overflow-x-auto p-0">
            <div className="min-w-[720px]">
              {/* Column header — shares the row grid so cells line up */}
              <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_5rem_6.5rem_9rem_1.25rem] items-center gap-3 border-b border-border bg-il-tint px-4 py-2.5 font-mono-cli text-sm text-il-navy">
                <span>#</span>
                <span>Name</span>
                <span className="text-right">
                  <abbr
                    title="Weighted composite against the framework, out of 100. Higher is stronger."
                    className="no-underline"
                  >
                    Score
                  </abbr>
                </span>
                <span>Coverage</span>
                <span>Classification</span>
                <span aria-hidden />
              </div>

              {rankedItems.map((it) => {
                const evidenceRows = evidenceByItem.get(it.id) ?? [];
                const prices = it.security_id
                  ? (pricesBySecurity.get(it.security_id) ?? [])
                  : [];
                const points: PricePoint[] = prices.map((p) => ({
                  date: p.snapshot_date,
                  close: p.close,
                }));
                const currency =
                  prices.find((p) => p.currency)?.currency ?? null;
                const criteria = it.scoring_breakdown?.criteria ?? {};

                return (
                  <details
                    key={it.id}
                    className="group border-t border-border first:border-t-0"
                  >
                    <summary className="grid cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)_5rem_6.5rem_9rem_1.25rem] items-center gap-3 px-4 py-2.5 text-base marker:content-none hover:bg-il-tint/60">
                      <span className="font-mono-cli text-sm text-muted-foreground">
                        {it.rank}
                      </span>
                      <span className="min-w-0 truncate">
                        <span className="font-mono-cli font-bold text-il-navy">
                          {it.security ? securityDisplayLabel(it.security) : "—"}
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          {it.security ? securitySecondaryLabel(it.security) : ""}
                        </span>
                      </span>
                      <span className="text-right font-mono-cli">
                        {displayComposite(it)}
                      </span>
                      <span>
                        {/* Coverage is near-always 100% post-freshness-fixes,
                            so show the bar only when there's a genuine gap —
                            a partial then stands out instead of being noise. */}
                        {coverageOf(it) < 0.999 ? (
                          <CoverageBar coverage={coverageOf(it)} />
                        ) : (
                          <span
                            className="font-mono-cli text-sm text-muted-foreground"
                            title="Full data coverage against the framework"
                          >
                            full
                          </span>
                        )}
                      </span>
                      <span>
                        {it.classification ? (
                          <ClassificationChip classification={it.classification} />
                        ) : (
                          "—"
                        )}
                      </span>
                      <span
                        aria-hidden
                        className="justify-self-end font-mono-cli text-muted-foreground transition-transform group-open:rotate-90"
                      >
                        ›
                      </span>
                    </summary>

                    <div className="border-t border-border bg-il-tint/40 px-4 py-4">
                      {it.verdict && (
                        <p className="mb-4 text-base leading-relaxed">
                          {it.verdict}
                        </p>
                      )}

                      {Object.keys(criteria).length > 0 && (
                        <div className="mb-4 flex flex-wrap items-start gap-4">
                          <CriteriaRadar
                            criteria={Object.entries(criteria).map(
                              ([key, c]) => ({ key, score: c.score }),
                            )}
                          />
                          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                            {[...Object.entries(criteria)]
                              .sort(
                                ([, a], [, b]) =>
                                  (a.score === null ? 1 : 0) -
                                  (b.score === null ? 1 : 0),
                              )
                              .map(([key, c]) => (
                                <div
                                  key={key}
                                  className={`rounded border px-3 py-2 ${
                                    c.score === null
                                      ? "border-dashed border-border/70 opacity-70"
                                      : "border-border"
                                  }`}
                                >
                                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                                    {classificationLabel(key)}
                                  </div>
                                  <div className="mt-1 font-mono-cli text-base">
                                    {c.score === null ? (
                                      <span className="text-muted-foreground">
                                        no data
                                      </span>
                                    ) : (
                                      <>
                                        {c.score.toFixed(1)}
                                        <span className="ml-0.5 text-sm text-muted-foreground">
                                          /100
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  {c.score === null && (
                                    <div className="mt-1 text-sm leading-snug text-muted-foreground">
                                      {noDataReason(
                                        key,
                                        it.security?.exchange ?? null,
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {points.length >= 2 && (
                        <div className="mb-4">
                          <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                            Price — trailing year
                          </div>
                          <PriceChart points={points} currency={currency} />
                        </div>
                      )}

                      <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                        {evidenceRows.length} cited source
                        {evidenceRows.length === 1 ? "" : "s"}
                      </div>
                      {evidenceRows.length > 0 ? (
                        <ul className="space-y-2">
                          {evidenceRows.map((ev) => (
                            <li key={ev.id}>
                              {ev.evidence_type === "news_article" ||
                              ((ev.evidence_type === "filing_section" ||
                                ev.evidence_type === "macro_indicator") &&
                                ev.source_text.startsWith("[")) ? (
                                <NewsEvidenceCard
                                  text={ev.source_text}
                                  weight={ev.weight}
                                />
                              ) : (
                                <div className="rounded border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                                  <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                                    <span>
                                      {ev.evidence_type.replace(/_/g, " ")}
                                    </span>
                                    <span>· {confidenceWord(ev.weight)} confidence</span>
                                  </div>
                                  <p className="leading-relaxed">
                                    {ev.source_text}
                                  </p>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No evidence rows persisted for this candidate.
                        </p>
                      )}

                      {it.security_id && (
                        <p className="mt-4 border-t border-border pt-3 font-mono-cli text-sm">
                          <Link
                            href={`/names/${it.security_id}`}
                            className="text-il-accent hover:text-il-orange"
                          >
                            see the desk&apos;s read on{" "}
                            {it.security ? securityDisplayLabel(it.security) : "this name"} →
                          </Link>
                        </p>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Score = weighted composite against the framework (higher is
            stronger). Coverage = how much of the framework had data for that
            name; classifications are withheld below 35%. Every score is
            defensible from the sources inside its row.
          </p>
        </section>
      )}

      {/* Drops we can't explain yet — real events, but unranked: an overshoot
          verdict without a news grade would be unsupported */}
      {unconfirmedItems.length > 0 && (
        <section className="card-cli mt-6 px-5 py-4">
          <div className="font-mono-cli text-base text-il-navy">
            ~ {unconfirmedItems.length} drop
            {unconfirmedItems.length === 1 ? "" : "s"} unranked — cause
            unconfirmed
          </div>
          <ul className="mt-3 space-y-2">
            {unconfirmedItems.map((it) => (
              <li key={it.id} className="text-base leading-relaxed">
                <span className="font-mono-cli font-bold text-il-navy">
                  {it.security ? securityDisplayLabel(it.security) : "—"}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {it.verdict ??
                    "Cleared the drop screen, but no news grade is available this run."}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            These moves are real, but the news research behind the verdict
            didn&apos;t complete — so no overshoot judgment is made. They
            re-qualify automatically on the next run.
          </p>
        </section>
      )}

      {/* Corporate actions — the screen fired, but the shares didn't fall.
          Named rather than hidden: a reader who saw the price move needs to
          know the desk saw it too and what it actually was. */}
      {corporateActionItems.length > 0 && (
        <section className="card-cli mt-6 px-5 py-4">
          <div className="font-mono-cli text-base text-il-navy">
            ~ {corporateActionItems.length} screened fall
            {corporateActionItems.length === 1 ? "" : "s"} — corporate action,
            not a loss of value
          </div>
          <ul className="mt-3 space-y-2">
            {corporateActionItems.map((it) => (
              <li key={it.id} className="text-base leading-relaxed">
                <span className="font-mono-cli font-bold text-il-navy">
                  {it.security ? securityDisplayLabel(it.security) : "—"}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {it.verdict ??
                    "The screened fall reflects a corporate action rather than a loss of value."}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            A split, consolidation, demerger or large special dividend shows up
            in an unadjusted price series as a steep drop. These aren&apos;t
            ranked for overshoot: the price move the framework would score
            didn&apos;t happen.
          </p>
        </section>
      )}

      {/* Excluded names — an honest note, not two screens of dashes */}
      {excludedItems.length > 0 && (
        <details className="card-cli mt-6 px-5 py-4">
          <summary className="cursor-pointer font-mono-cli text-base text-muted-foreground marker:content-none">
            ~ {excludedItems.length} name{excludedItems.length === 1 ? "" : "s"}{" "}
            excluded — no data on current sources
          </summary>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {excludedItems
              .map((i) => (i.security ? securityDisplayLabel(i.security) : "—"))
              .join(", ")}{" "}
            had no usable data this run, so nothing was scored or classified.
            They stay in the universe and fill in automatically when data
            lands.
          </p>
        </details>
      )}

      {/* The agent's prose, demoted to an appendix — except the Geopolitical
          desk, whose write-up is the macro read already shown open at the top. */}
      {!isMacroMemo && (
        <details className="card-cli mt-10 px-5 py-4">
          <summary className="cursor-pointer font-mono-cli text-base text-muted-foreground marker:content-none">
            ~ analyst note — the desk&apos;s full write-up
          </summary>
          <article className="md mt-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {report.body_markdown}
            </ReactMarkdown>
          </article>
        </details>
      )}

      <Disclaimer />
    </main>
    </>
  );
}
