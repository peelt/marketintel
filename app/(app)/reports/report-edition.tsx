import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/server";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { Disclaimer } from "@/components/disclaimer";
import { DotList } from "@/components/dot-list";
import {
  ClassificationChip,
  CoverageBar,
  MODULE_COLORS,
} from "@/components/cli";
import {
  compositeDisplay,
  confidenceWord,
  criterionExplainer,
  criterionLabel,
  dropDisplay,
  formatEditionDate,
  formatPriceDate,
  formatShortDate,
  humanizeDateTime,
  parseVerdictDrop,
  pluralizeCounts,
  securityDisplayLabel,
  securitySecondaryLabel,
} from "@/lib/format";
import { CriteriaRadar } from "@/components/criteria-radar";
import { NewsEvidenceCard } from "@/components/news-evidence";
import { MacroRead } from "@/components/macro-read";
import { parseMacroMemo } from "@/lib/reports/macro-memo";
import {
  ReactionPricePanel,
  ReactionPriceSkeleton,
  ReactionPriceUnavailable,
} from "@/components/reaction-price-panel";
import {
  buildReactionPriceContext,
  loadReactionPriceRows,
  type PriceRowInput,
} from "@/lib/reports/reaction-price";
import { resolveScreenedDate } from "@/lib/scorecard/screened-date";
import { onDemandTickers } from "@/lib/reports/editions";

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
  /** The run that filed it (to-one embed). Null if it can't be read. */
  run: RunRow | null;
}

interface ReportItemRow {
  id: string;
  rank: number;
  security_id: string | null;
  composite_score: number;
  scoring_breakdown: {
    /** 0–1 share of framework weight that had data behind it. */
    coverage?: number;
    /** The close the verdict graded, pinned at report time (Reaction). */
    screenedAt?: string | null;
    criteria?: Record<
      string,
      { score: number | null; signals: Record<string, number | null> }
    >;
  };
  verdict: string | null;
  classification: string | null;
  security: {
    ticker: string;
    exchange: string;
    name: string;
    currency: string | null;
  } | null;
  /** Embedded on the items query so the evidence isn't a second round-trip. */
  evidence: EvidenceRow[] | null;
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

interface RunRow {
  /** jsonb — read only for its `tickers` (an on-demand run). */
  input_params: unknown;
  framework_id: string | null;
  framework: { version: number } | null;
  started_at: string;
  finished_at: string | null;
  status: string;
}

/**
 * One filed edition, in full. Rendered by BOTH reports routes: `/reports`
 * (the latest daily edition, open by default) and `/reports/[id]` (any other).
 * The pages own auth and which id to show; the reports layout owns the frame
 * and the edition navigator, which stays mounted while this swaps beneath it.
 */
export async function ReportEdition({ reportId: id }: { reportId: string }) {
  const supabase = await createClient();
  // The whole edition in ONE wave: the report with its run embedded, and the
  // items (evidence embedded) keyed straight off the report id. This was two
  // serial hops — report, then run + items — because the run was looked up by
  // the report's `agent_run_id`; nothing here actually needs the first answer
  // to ask the second question. `/reports` already spends a hop finding which
  // edition is the latest, so this keeps it at two rather than three.
  // The gates below still apply: an unknown, retired or non-succeeded report
  // simply discards the items it fetched rather than never fetching them.
  const [{ data: report, error: reportErr }, { data: items, error: itemsErr }] =
    await Promise.all([
      supabase
        .from("reports")
        .select(
          "id, agent_run_id, agent_name, generated_at, summary_markdown, body_markdown, run:agent_runs(framework_id, started_at, finished_at, status, input_params, framework:scoring_frameworks(version))",
        )
        .eq("id", id)
        .maybeSingle<ReportRow>(),
      supabase
        .from("report_items")
        .select(
          "id, rank, security_id, composite_score, scoring_breakdown, verdict, classification, security:securities(ticker, exchange, name, currency), evidence(id, report_item_id, evidence_type, source_table, source_text, weight, redistributable)",
        )
        .eq("report_id", id)
        .order("rank", { ascending: true })
        .returns<ReportItemRow[]>(),
    ]);
  // A read error must not masquerade as "not found" (404) — surface it.
  if (reportErr) throw new Error(`report load: ${reportErr.message}`);
  if (!report) notFound();
  // Retired desks' editions are withdrawn from the product (2026-07 scope
  // reduction) — the rows stay in the database, but a direct URL must not
  // keep serving content the list no longer offers.
  if (agentRegistry.get(report.agent_name as AgentName)?.status === "retired") {
    notFound();
  }
  const run = report.run;

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
        <main>
          <h1 className="text-3xl font-bold text-il-navy">
            {meta?.displayName ?? report.agent_name}
          </h1>
          <p className="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-base text-amber-700">
            This report isn&apos;t available — its run{" "}
            {run ? (
              <>finished with status <strong>{run.status}</strong></>
            ) : (
              "record could not be loaded"
            )}
            , so nothing here is shown. The{" "}
            <Link href="/reports" className="underline">
              latest edition
            </Link>{" "}
            is always a run that completed successfully.
          </p>
          <Disclaimer />
        </main>
      </>
    );
  }

  // Don't let an errored items read render as a report with zero candidates
  // (indistinguishable from a genuinely empty one).
  if (itemsErr) throw new Error(`report items load: ${itemsErr.message}`);

  const allItems = items ?? [];

  // Evidence rides along on each item (embedded select above) — the glass-box
  // promise: every score defensible from its cited rows. Heaviest-weighted
  // source first, which the embed doesn't order for us.
  const evidenceByItem = new Map<string, EvidenceRow[]>();
  for (const it of allItems) {
    evidenceByItem.set(
      it.id,
      [...(it.evidence ?? [])].sort((a, b) => b.weight - a.weight),
    );
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
  // The price behind each ranked Reaction verdict. Started here and NOT
  // awaited: each row's panel streams in through its own Suspense boundary,
  // so the report paints exactly as fast as it did before prices were shown.
  // One read per name (see loadReactionPriceRows), fail-soft per name.
  const reportDate = report.generated_at.slice(0, 10);
  const screenedDateOf = (it: ReportItemRow): string =>
    resolveScreenedDate({
      breakdown: it.scoring_breakdown ?? null,
      verdict: it.verdict,
      fallback: reportDate,
    }).date ?? reportDate;
  const pricesPromise: Promise<Map<string, PriceRowInput[] | null>> =
    report.agent_name === "reaction"
      ? loadReactionPriceRows(
          supabase,
          rankedItems.flatMap((it) =>
            it.security_id
              ? [{ securityId: it.security_id, screenedDate: screenedDateOf(it) }]
              : [],
          ),
        )
      : Promise.resolve(new Map());

  // The close this edition grades, for the header — stated only when the
  // desk PINNED it at report time (scoring_breakdown.screenedAt), never
  // inferred. The verdict's "(as of … close)" stamp can't stand in: before the
  // retime it marked only lagging names, so it would name a laggard's date as
  // the edition's. Most-common pinned date; older editions simply omit it.
  const gradedClose = mostCommon(
    allItems.flatMap((it) =>
      it.scoring_breakdown?.screenedAt ? [it.scoring_breakdown.screenedAt.slice(0, 10)] : [],
    ),
  );
  // A per-ticker run files a report too, but it is not a daily edition.
  const requestedTickers = onDemandTickers(run?.input_params);

  const excludedItems = allItems.filter(
    (i) => coverageOf(i) === 0 && i.classification !== "corporate_action",
  );

  // Parse the macro read into structured themes for the accordion render;
  // null (any other desk, no read this run, or an unparseable memo) falls back
  // to raw markdown for the hybrid desk so nothing is ever dropped.
  const parsedMemo = hasMacroSection
    ? parseMacroMemo(report.body_markdown)
    : null;

  return (
    <>
    <main>
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-bold text-il-navy">
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: moduleColor }}
          />
          {meta?.displayName ?? report.agent_name}
        </h1>
        {/* Which edition this is, when it was filed, and the close it grades.
            The weekday matters: editions are filed just after midnight UTC, so
            Friday's falls are in SATURDAY's edition, and the graded close is
            what makes that read as intended rather than as a mistake. (Moving
            between editions is the navigator's job, in the reports layout.) */}
        <DotList className="mt-2 font-mono-cli text-sm text-muted-foreground">
          <span className="text-il-navy">
            {requestedTickers
              ? `on-demand analysis, ${formatEditionDate(reportDate)}`
              : `${formatEditionDate(reportDate)} edition`}
          </span>
          <span>filed {filedLabel(report.generated_at)}</span>
          {gradedClose && <span>grades the {formatShortDate(gradedClose)} close</span>}
        </DotList>
        {/* Standfirst — the edition's conclusion in words, straight from the
            desk's own summary. (What this desk is and how it scores lives in
            the collapsed "how this edition was made" footer, not up here.) */}
        <div className="mt-4 max-w-3xl text-base leading-relaxed text-il-navy [&_p+p]:mt-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {pluralizeCounts(report.summary_markdown)}
          </ReactMarkdown>
        </div>
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

      {/* Ranked candidates — one scannable table whose rows OPEN into the
          evidence behind each score. (Previously this was two stacked lists
          repeating the same names; the ranking and its evidence are one thing,
          so they're one thing here.) */}
      {rankedItems.length > 0 && (
        <section className="mt-8">
          <div className="font-mono-cli text-base text-il-navy">~ ranked candidates</div>
          <p className="mt-1 text-sm text-muted-foreground">
            open a row for the evidence behind its verdict
          </p>
          {/* Below sm the table is NOT a 720px horizontal scroller: each
              summary stacks onto two lines (name + fall, then verdict +
              score, figures right-aligned) and an opened row gets the full
              screen width — the price panel inside it is what a reader checks
              against the broker app on their phone. */}
          <div className="card-cli mt-3 p-0 sm:overflow-x-auto">
            <div className="sm:min-w-[720px]">
              {/* Column header — shares the row grid so cells line up */}
              <div className="hidden grid-cols-[1.75rem_minmax(0,1fr)_7rem_5rem_9rem_1.25rem] items-center gap-3 border-b border-border bg-il-tint px-4 py-2.5 font-mono-cli text-sm text-il-navy sm:grid">
                <span>#</span>
                <span>Name</span>
                <span className="text-right">
                  <abbr
                    title="The screened fall the verdict grades — % move / window in trading days"
                    className="no-underline"
                  >
                    Drop
                  </abbr>
                </span>
                <span className="text-right">
                  <abbr
                    title="Weighted composite against the framework, out of 100. Higher is stronger."
                    className="no-underline"
                  >
                    Score
                  </abbr>
                </span>
                <span>Classification</span>
                <span aria-hidden />
              </div>

              {rankedItems.map((it) => {
                const evidenceRows = evidenceByItem.get(it.id) ?? [];
                const criteria = it.scoring_breakdown?.criteria ?? {};
                const drop = parseVerdictDrop(it.verdict);
                const partial = coverageOf(it) < 0.999;

                return (
                  <details
                    key={it.id}
                    className="group border-t border-border first:border-t-0"
                  >
                    <summary className="grid cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)_auto_1.25rem] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-base marker:content-none hover:bg-il-tint/60 sm:grid-cols-[1.75rem_minmax(0,1fr)_7rem_5rem_9rem_1.25rem] sm:gap-y-0">
                      <span className="col-start-1 row-start-1 font-mono-cli text-sm text-muted-foreground sm:col-auto sm:row-auto">
                        {it.rank}
                      </span>
                      <span className="col-start-2 row-start-1 min-w-0 truncate sm:col-auto sm:row-auto">
                        <span className="font-mono-cli font-bold text-il-navy">
                          {it.security ? securityDisplayLabel(it.security) : "—"}
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          {it.security ? securitySecondaryLabel(it.security) : ""}
                        </span>
                      </span>
                      {/* The fall itself — small red figure per the family
                          spec (alert colours are glyph-scale only). "—" when
                          the verdict quotes no move; never a made-up number. */}
                      <span className="col-start-3 row-start-1 text-right font-mono-cli text-sm sm:col-auto sm:row-auto">
                        {drop ? (
                          <span style={{ color: drop.pct < 0 ? "#EE1D23" : undefined }}>
                            {dropDisplay(drop)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                      <span className="col-start-3 row-start-2 text-right font-mono-cli sm:col-auto sm:row-auto">
                        {displayComposite(it)}
                        {/* No column header on a phone: carry the scale. */}
                        <span className="ml-0.5 text-sm text-muted-foreground sm:hidden">
                          /100
                        </span>
                        {/* Coverage is near-always full now; a partial scores
                            from less data, and says so in the open row. */}
                        {partial && (
                          <span
                            className="ml-0.5 text-muted-foreground"
                            title="Scored from partial data — open the row for what was missing"
                          >
                            *
                          </span>
                        )}
                      </span>
                      <span className="col-start-2 row-start-2 min-w-0 sm:col-auto sm:row-auto">
                        {it.classification ? (
                          <ClassificationChip classification={it.classification} />
                        ) : (
                          "—"
                        )}
                      </span>
                      <span
                        aria-hidden
                        className="col-start-4 row-start-1 justify-self-end font-mono-cli text-muted-foreground transition-transform group-open:rotate-90 sm:col-auto sm:row-auto"
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

                      {report.agent_name === "reaction" && it.security_id && (
                        <div className="mb-4">
                          <Suspense fallback={<ReactionPriceSkeleton />}>
                            <ReactionPriceSlot
                              rows={pricesPromise}
                              securityId={it.security_id}
                              screenedDate={screenedDateOf(it)}
                              sessions={drop?.sessions ?? null}
                              ticker={it.security ? securityDisplayLabel(it.security) : "This name"}
                              fallbackCurrency={it.security?.currency ?? null}
                            />
                          </Suspense>
                        </div>
                      )}

                      {partial && (
                        <div className="mb-4 flex items-center gap-2 font-mono-cli text-sm text-muted-foreground">
                          coverage <CoverageBar coverage={coverageOf(it)} />
                          <span>
                            — the score is computed from the framework weight
                            that had data; the gaps are named below.
                          </span>
                        </div>
                      )}

                      {Object.keys(criteria).length > 0 && (
                        <div className="mb-4 flex flex-wrap items-start gap-4">
                          <CriteriaRadar
                            criteria={Object.entries(criteria).map(
                              ([key, c]) => ({ key, score: c.score }),
                            )}
                          />
                          {/* One row per criterion, read as the radar's key:
                              what it is, what it measures, its score. */}
                          <ul className="min-w-[16rem] flex-1 space-y-2">
                            {[...Object.entries(criteria)]
                              .sort(
                                ([, a], [, b]) =>
                                  (a.score === null ? 1 : 0) -
                                  (b.score === null ? 1 : 0),
                              )
                              .map(([key, c]) => {
                                const explainer =
                                  c.score === null
                                    ? noDataReason(key, it.security?.exchange ?? null)
                                    : criterionExplainer(key, c.signals);
                                return (
                                  <li
                                    key={key}
                                    className={`flex items-start justify-between gap-4 rounded border px-3 py-2 ${
                                      c.score === null
                                        ? "border-dashed border-border/70 opacity-70"
                                        : "border-border bg-white"
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                                        {criterionLabel(key)}
                                      </div>
                                      {explainer && (
                                        <p className="mt-1 text-sm leading-snug text-muted-foreground">
                                          {explainer}
                                        </p>
                                      )}
                                    </div>
                                    <div className="shrink-0 whitespace-nowrap font-mono-cli text-base text-il-navy">
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
                                  </li>
                                );
                              })}
                          </ul>
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
        </section>
      )}

      {/* Reaction's macro backdrop — what was moving prices when these names
          fell, so a drop reads as company-specific or as part of a wider move.
          Below the names: it explains the day, it doesn't rank it. COMPACT by
          default — rendered open it ran to a screen of market commentary.
          Silently absent when the read failed (the body still says so in the
          analyst note) — an empty backdrop is not a finding. */}
      {/* No driverLine here: the standfirst up top already ends with the
          attribution roll-up — repeating it one screen later read as an echo. */}
      {!isMacroMemo && parsedMemo && (
        <section className="card-cli mt-6 p-5">
          <MacroRead memo={parsedMemo} compact />
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

      {/* Methodology, in one collapsed place — the desk's scope, the scoring
          explainer, and the run's provenance. Repeating these open on every
          edition buried the names under boilerplate. */}
      <details className="card-cli mt-4 px-5 py-4">
        <summary className="cursor-pointer font-mono-cli text-base text-muted-foreground marker:content-none">
          ~ how this edition was made
        </summary>
        <div className="mt-3 space-y-3 text-base leading-relaxed text-muted-foreground">
          {meta?.scope && <p>{meta.scope}</p>}
          <p>
            Score = weighted composite against the framework (higher is
            stronger). Coverage = how much of the framework had data for that
            name; classifications are withheld below 35%. Every score is
            defensible from the sources inside its row.
          </p>
          <p className="font-mono-cli text-sm">
            filed {humanizeDateTime(report.generated_at)}
            {run?.framework?.version != null && (
              <> · framework v{run.framework.version}</>
            )}
          </p>
        </div>
      </details>

      <Disclaimer />
    </main>
    </>
  );
}

/**
 * One row's price panel. Awaits the edition-wide price read (shared by every
 * row; started, never awaited, by the page) inside the row's own Suspense
 * boundary. Every failure mode renders a one-line reason, never a blank.
 */
async function ReactionPriceSlot({
  rows,
  securityId,
  screenedDate,
  sessions,
  ticker,
  fallbackCurrency,
}: {
  rows: Promise<Map<string, PriceRowInput[] | null>>;
  securityId: string;
  screenedDate: string;
  sessions: number | null;
  ticker: string;
  fallbackCurrency: string | null;
}) {
  const series = (await rows).get(securityId);
  if (series === null) {
    return (
      <ReactionPriceUnavailable reason="Price history couldn't be loaded just now. The move above is the figure the desk filed." />
    );
  }
  const ctx = series
    ? buildReactionPriceContext(series, { screenedDate, sessions, fallbackCurrency })
    : null;
  if (!ctx) {
    return (
      <ReactionPriceUnavailable
        reason={`No stored close around ${formatPriceDate(screenedDate)}, so the move can't be charted. The figure above is the one the desk filed.`}
      />
    );
  }
  return <ReactionPricePanel ctx={ctx} sessions={sessions} ticker={ticker} />;
}

/** The most frequent value, earliest-seen winning a tie. Null when empty. */
function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

/**
 * "today, 00:41" / "yesterday, 00:40" while that is useful; otherwise just
 * the time — the edition's date is already stated beside it, and "Sat 14 Nov
 * 2026 edition · filed 14 Nov, 00:40" said it twice.
 */
function filedLabel(generatedAt: string): string {
  const relative = humanizeDateTime(generatedAt);
  if (/^(today|yesterday),/.test(relative)) return relative;
  const t = Date.parse(generatedAt);
  return Number.isFinite(t) ? `${new Date(t).toISOString().slice(11, 16)} UTC` : relative;
}
