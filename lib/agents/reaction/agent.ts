import { BaseAgent } from "../base";
import { agentRegistry } from "../registry";
import type {
  AgentMeta,
  AgentRunInput,
  EvidenceItem,
  ScoringFramework,
} from "../types";
import type { CandidateScore, SignalResolverRegistry } from "@/lib/scoring/types";
import { loadBroadUniverse, loadRecentSeries } from "./data";
import {
  DEFAULT_THRESHOLDS,
  dropSeverity,
  dropStats,
  median,
  passesDropScreen,
  thresholdsFromParams,
  type DropStats,
  type InclusionThresholds,
} from "./metrics";
import { createReactionResolver, type ReactionRunContext } from "./resolvers";
import { researchReactionMacro, type MacroRead } from "./macro";
import { describeMacroDriver, type ReactionNewsGrade } from "./news";
import { formatPriceDate, hostOf } from "@/lib/format";
import { loadPriorOvershootFlags } from "./prior-flags";

/**
 * Reaction Analyser — the hero pole (PR 5, M3).
 *
 * Screens the broad market (S&P 500 + FTSE 350, tagged 'broad_market') for
 * names that cleared the inclusion threshold — 5-session drawdown or
 * 1-session drop, thresholds read from framework params (settled: 12% / 8%)
 * — then scores each on OVERSHOOT-NESS: how disproportionate the move looks
 * against the earned fundamental damage identified in current news.
 *
 * Verdict bands over the composite (which is calibrated by the two absolute
 * LLM grades and the framework weights):
 *   ≥72 strong_overshoot · ≥58 mild_overshoot · ≥42 proportionate ·
 *   <42 underreaction — withheld entirely below the coverage floor.
 */

const MAX_CANDIDATES = 20;
const MIN_COVERAGE_TO_CLASSIFY = 0.35;
const BANDS = {
  strongOvershootMin: 72,
  mildOvershootMin: 58,
  proportionateMin: 42,
} as const;

export type ReactionClassification =
  | "strong_overshoot"
  | "mild_overshoot"
  | "proportionate"
  | "underreaction"
  | "cause_unconfirmed"
  | "corporate_action"
  | "insufficient_data";

/** Outcome of screening one on-demand requested ticker. */
export interface OnDemandOutcome {
  ticker: string;
  /** Found in the reaction universe at all? */
  matched: boolean;
  /** Cleared the drop screen (only meaningful when matched)? */
  passed: boolean;
  stats: DropStats | null;
}

/**
 * Plain-English outcome line for an on-demand request — the user asked about a
 * specific name, so the report must answer about THAT name even when there's
 * nothing to grade. Pure; exported for tests. Impersonal language (I2).
 */
export function describeOnDemandOutcome(
  o: OnDemandOutcome,
  thresholds: { drawdown5dPct: number; drop1dPct: number },
): string {
  if (!o.matched) {
    return `**${o.ticker}** was requested on demand but isn't in the Reaction universe (S&P 500 + FTSE 350), so it can't be screened.`;
  }
  const move5 = o.stats?.return5d ?? null;
  const move1 = o.stats?.return1d ?? null;
  if (move5 === null && move1 === null) {
    return `**${o.ticker}** was requested on demand but has too little recent price history to screen.`;
  }
  const moves = [
    move5 !== null ? `${(move5 * 100).toFixed(1)}% over 5 sessions` : null,
    move1 !== null ? `${(move1 * 100).toFixed(1)}% on the day` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  if (!o.passed) {
    return `**${o.ticker}** was requested on demand: ${moves} at the latest close does not clear the drop screen (a fall of ${thresholds.drawdown5dPct}%+ over 5 sessions or ${thresholds.drop1dPct}%+ in one) — the desk only grades qualifying drops, so no overshoot verdict is filed.`;
  }
  return `**${o.ticker}** was requested on demand and cleared the drop screen (${moves}); its verdict is below.`;
}

/**
 * One-line roll-up of how the run's drops were attributed. Returns null when
 * no name carried an attribution (no macro read, or no grades landed) — the
 * report then says nothing rather than implying every drop was company-
 * specific. Pure; exported for tests.
 */
export function summariseDrivers(
  grades: ReactionNewsGrade[],
): string | null {
  const attributed = grades.filter((g) => g.macroDriver !== "unattributed");
  if (attributed.length === 0) return null;

  const macro = attributed.filter(
    (g) => g.macroDriver === "macro_driven" || g.macroDriver === "macro_amplified",
  );
  if (macro.length === 0) {
    return `All ${attributed.length} graded drop(s) trace to company-specific news, not the macro backdrop.`;
  }

  // Name the theme carrying the most drops — the reader's question on a
  // red day is "is this one story or many?".
  const counts = new Map<string, number>();
  for (const g of macro) {
    if (g.macroTheme) counts.set(g.macroTheme, (counts.get(g.macroTheme) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const driven = macro.filter((g) => g.macroDriver === "macro_driven").length;

  return [
    `${macro.length} of ${attributed.length} graded drop(s) trace to the macro backdrop`,
    top ? ` — most to **${top[0]}** (${top[1]})` : "",
    driven > 0
      ? `; ${driven} fell with little company-specific news of ${driven === 1 ? "its" : "their"} own.`
      : ".",
  ].join("");
}

/**
 * Force the requested (qualifying) names into the scored cohort even past the
 * severity cap. The cohort deliberately stays the FULL screened set: three of
 * the framework's five sub-signals are rank-normalised, and a cohort of one
 * scores 100 on every rank signal — an on-demand name must be graded against
 * the day's real peer context, not alone. Pure; exported for tests.
 */
export function mergeRequestedIntoCohort(
  cohort: string[],
  requiredIds: string[],
): string[] {
  const seen = new Set(cohort);
  const out = [...cohort];
  for (const id of requiredIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export class ReactionAgent extends BaseAgent {
  readonly meta: AgentMeta = agentRegistry.get("reaction")!;
  // Ranking and classification share the floor: a name too thin to classify
  // is also too thin to compete for rank.
  protected override coverageFloor = MIN_COVERAGE_TO_CLASSIFY;

  /**
   * The news grade is the DEFINING evidence of an overshoot verdict; a name
   * that lacks it is classified cause_unconfirmed and must not compete with
   * fully-evidenced names — its remaining signals are price-derived and
   * circular (a big drop "proving" a big overshoot).
   *
   * The same reasoning excludes a corporate action: "overshoot" presupposes
   * the fall was REAL, and a 10-for-1 split reads as -90% against near-zero
   * news damage — the maximum-disproportion shape, so an artefact would
   * otherwise top the ranking (it did: CGT, 27 Jul 2026). Suspected counts as
   * well as confirmed: if the desk can't say the move was real, it can't call
   * it disproportionate.
   */
  protected override demoteFromRanking(scored: CandidateScore): boolean {
    if (scored.coverage < this.coverageFloor) return true;
    const grade = this.ctx?.newsGrades.get(scored.securityId);
    if (grade && grade.corporateAction !== "none") return true;
    return (
      scored.criteria["earned_damage"]?.signals?.["news_damage_severity"]?.raw ==
      null
    );
  }

  private ctx: ReactionRunContext | null = null;
  private screenSummary = { universe: 0, screened: 0, capped: 0 };
  /** Pinned at screen time so verdicts quote the leg that actually cleared. */
  private thresholds: InclusionThresholds = DEFAULT_THRESHOLDS;
  /** Earlier overshoot flags on this run's names (repeat-flag context). */
  private priorFlags = new Map<string, PriorFlag>();
  /** Set when this run is an on-demand per-ticker request. */
  private scoped: {
    outcomes: OnDemandOutcome[];
    thresholds: ReturnType<typeof thresholdsFromParams>;
  } | null = null;

  protected async collectCandidates(
    framework: ScoringFramework,
    input: AgentRunInput,
  ): Promise<string[]> {
    // The agent instance is a module singleton — clear per-run state so an
    // on-demand run never leaks its scope into a later scheduled run in the
    // same warm process.
    this.scoped = null;
    this.priorFlags = new Map();
    const thresholds = thresholdsFromParams(framework.params);
    this.thresholds = thresholds;
    const asOf = new Date().toISOString().slice(0, 10);
    const universe = await loadBroadUniverse();
    const series = await loadRecentSeries(
      universe.map((u) => u.id),
      100, // ~68 sessions: enough for 5d returns + the 35-session volume baseline
    );

    const stats = new Map<string, DropStats>();
    const all5d: number[] = [];
    for (const security of universe) {
      const s = dropStats(series.get(security.id) ?? []);
      stats.set(security.id, s);
      if (s.return5d !== null) all5d.push(s.return5d);
    }

    const screened = universe
      .filter((u) => passesDropScreen(stats.get(u.id)!, thresholds))
      .sort(
        (a, b) => dropSeverity(stats.get(a.id)!) - dropSeverity(stats.get(b.id)!),
      );

    // No silent caps: the cut is recorded and reported in the body.
    const capped = screened.slice(0, MAX_CANDIDATES);
    this.screenSummary = {
      universe: universe.length,
      screened: screened.length,
      capped: screened.length - capped.length,
    };

    // On-demand mode: the user asked about specific names. Screen them like
    // any other name; if one qualifies, force it into the (full) cohort so
    // it's graded in real peer context; if none qualifies, skip scoring and
    // let emptySummary() answer factually about the requested names.
    const requested = (input.tickers ?? [])
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    let candidates: string[];
    if (requested.length > 0) {
      const byTicker = new Map(
        universe.map((u) => [u.ticker.toUpperCase(), u]),
      );
      const outcomes: OnDemandOutcome[] = requested.map((ticker) => {
        const sec = byTicker.get(ticker) ?? null;
        const s = sec ? (stats.get(sec.id) ?? null) : null;
        return {
          ticker,
          matched: !!sec,
          passed: !!sec && !!s && passesDropScreen(s, thresholds),
          stats: s,
        };
      });
      this.scoped = { outcomes, thresholds };
      const requiredIds = outcomes
        .filter((o) => o.passed)
        .map((o) => byTicker.get(o.ticker)!.id);
      candidates =
        requiredIds.length === 0
          ? []
          : mergeRequestedIntoCohort(
              capped.map((u) => u.id),
              requiredIds,
            );
    } else {
      candidates = capped.map((u) => u.id);
    }

    // The macro backdrop is researched once per run and shared by every
    // per-name news call. Deliberately AFTER the screen: on a calm day nothing
    // qualifies, and a backdrop with no drops to attribute is a call paid for
    // nothing. Fail-soft — a null read means names are graded exactly as they
    // were before this layer existed.
    const macro = candidates.length > 0 ? await researchReactionMacro(asOf) : null;

    // Repeat-flag context: which of these names an earlier edition already
    // called, and what price has done since. Fail-soft — a failure here just
    // omits the annotation.
    this.priorFlags =
      candidates.length > 0
        ? await loadPriorOvershootFlags(candidates, series)
        : new Map();

    this.ctx = {
      securities: new Map(universe.map((u) => [u.id, u])),
      screenSeries: series,
      stats,
      universeMedian5d: median(all5d),
      asOf,
      macro,
      newsGrades: new Map(),
    };

    return candidates;
  }

  protected override emptySummary(): string {
    if (this.scoped) {
      return this.scoped.outcomes
        .map((o) => describeOnDemandOutcome(o, this.scoped!.thresholds))
        .join(" ");
    }
    return super.emptySummary();
  }

  protected getResolver(_framework: ScoringFramework): SignalResolverRegistry {
    if (!this.ctx) {
      throw new Error("reaction resolver requested before candidate collection");
    }
    return createReactionResolver(this.ctx);
  }

  protected override classify(scored: CandidateScore): {
    verdict?: string | null;
    classification?: string | null;
  } {
    return classifyReaction(
      scored,
      this.ctx?.stats.get(scored.securityId) ?? null,
      this.ctx?.newsGrades.get(scored.securityId) ?? null,
      this.thresholds,
      {
        runDate: this.ctx?.asOf ?? null,
        priorFlag: this.priorFlags.get(scored.securityId) ?? null,
      },
    );
  }

  /**
   * The run's backdrop, emitted in the same markdown shape the retired
   * Geopolitical desk used — `lib/reports/macro-memo.ts` already parses that
   * shape into the theme accordions on the report page, so the layer gets its
   * render for free. Empty when nothing was screened: with no drops to
   * attribute, a backdrop is noise.
   */
  private macroSection(hasCandidates: boolean): string[] {
    if (!hasCandidates) return [];
    const macro: MacroRead | null = this.ctx?.macro ?? null;
    if (!macro) {
      return [
        `## Macro read`,
        ``,
        `_No macro read was available this run — each drop was researched on its own news, without a shared backdrop to attribute it against._`,
        ``,
      ];
    }
    const lines = [`## Macro read`, ``, `_${macro.asOfNote}_`, ``];
    for (const t of macro.themes) {
      lines.push(
        `### ${t.title}  ·  confidence: ${t.confidence}`,
        ``,
        t.summary,
        ``,
        `**Which way it cuts:** ${t.direction}${t.affectedSectors.length ? `  ·  _${t.affectedSectors.join(", ")}_` : ""}`,
        ``,
      );
    }
    if (macro.sources.length) {
      lines.push(
        `**Sources:** ${macro.sources.map((s) => `[${hostOf(s.url)}](${s.url})`).join(" · ")}`,
        ``,
      );
    }
    return lines;
  }

  protected async composeReport(input: {
    framework: ScoringFramework;
    scored: CandidateScore[];
    evidence: EvidenceItem[];
  }): Promise<{ summaryMarkdown: string; bodyMarkdown: string }> {
    const { framework, scored } = input;
    const { universe, screened, capped } = this.screenSummary;
    const label = (s: CandidateScore) =>
      this.ctx?.securities.get(s.securityId)?.ticker ?? "UNKNOWN";
    const classified = scored.map((s) => ({
      s,
      ...classifyReaction(
        s,
        this.ctx?.stats.get(s.securityId) ?? null,
        this.ctx?.newsGrades.get(s.securityId) ?? null,
        this.thresholds,
        {
          runDate: this.ctx?.asOf ?? null,
          priorFlag: this.priorFlags.get(s.securityId) ?? null,
        },
      ),
    }));

    const overshoots = classified.filter(
      (c) =>
        c.classification === "strong_overshoot" ||
        c.classification === "mild_overshoot",
    );
    const unconfirmed = classified.filter(
      (c) => c.classification === "cause_unconfirmed",
    );
    const corporateActions = classified.filter(
      (c) => c.classification === "corporate_action",
    );

    const summaryMarkdown = [
      // On-demand runs answer about the requested name(s) FIRST — that's what
      // the reader asked for; the cohort context follows.
      ...(this.scoped
        ? this.scoped.outcomes.map((o) =>
            describeOnDemandOutcome(o, this.scoped!.thresholds),
          )
        : []),
      `${universe} names screened; ${screened} cleared the drop threshold${capped > 0 ? ` (top ${scored.length} by severity analysed, ${capped} deferred)` : ""}.`,
      scored.length === 0
        ? "No qualifying drops this run."
        : overshoots.length > 0
          ? `Framework flags ${overshoots.length} move(s) as overshoot: ${overshoots
              .slice(0, 3)
              .map((c) => `**${label(c.s)}**`)
              .join(", ")}.`
          : "No screened move graded as overshoot — declines look earned or worse.",
      unconfirmed.length > 0
        ? `${unconfirmed.length} drop(s) unranked — no news grade this run: ${unconfirmed
            .map((c) => `**${label(c.s)}**`)
            .join(", ")}.`
        : "",
      // Named, not silently dropped: the screen did fire on these, and a
      // reader who saw the price move deserves to know why they're absent.
      corporateActions.length > 0
        ? `${corporateActions.length} screened fall(s) were corporate actions rather than losses of value, so no overshoot verdict was filed: ${corporateActions
            .map((c) => `**${label(c.s)}**`)
            .join(", ")}.`
        : "",
      // What drove the day, once — the reader's "is this one story or many?".
      summariseDrivers(
        scored
          .map((s) => this.ctx?.newsGrades.get(s.securityId))
          .filter((g): g is ReactionNewsGrade => !!g),
      ) ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    const lines: string[] = [
      `# Reaction Analyser`,
      ``,
      summaryMarkdown,
      ``,
      ...this.macroSection(scored.length > 0),
      `## How this is scored`,
      ``,
      `Inclusion: 5-session drawdown or 1-session drop past the framework's thresholds (v${framework.version} params). Each name is then scored on **overshoot-ness** — excess decline vs the market, the earned damage identified in current news (web-researched, graded 0–100 absolute), and how deep the repricing runs. Higher composite = more disproportionate move. Missing data redistributes weight and shows as coverage, never as zero.`,
      ``,
      `The macro read above is CONTEXT, not a scored signal: it tells each name's news research what is already moving prices, so a drop can be read as company-specific or as part of a wider move. It never adds or removes framework weight.`,
      ``,
    ];

    if (scored.length > 0) {
      lines.push(`## Verdicts`, ``);
      for (const c of classified) {
        const grade = this.ctx?.newsGrades.get(c.s.securityId);
        const driver = grade
          ? describeMacroDriver(grade.macroDriver, grade.macroTheme)
          : null;
        lines.push(
          `- **${label(c.s)}** — ${String(c.classification).replace(/_/g, " ")} (composite ${c.s.composite.toFixed(1)}, coverage ${Math.round(c.s.coverage * 100)}%${driver ? `, ${driver}` : ""}). ${c.verdict ?? ""}`,
        );
      }
    }

    if (capped > 0) {
      lines.push(
        ``,
        `_${capped} additional name(s) cleared the screen but were deferred this run (severity-ranked cap of ${MAX_CANDIDATES}); they re-qualify automatically next run if still down._`,
      );
    }

    lines.push(
      ``,
      `_Every verdict is defensible from its cited evidence — open a candidate to inspect the news sources and data rows behind it._`,
    );

    return { summaryMarkdown, bodyMarkdown: lines.join("\n") };
  }
}

/** An earlier edition's flag on the same name, and what price did since. */
export interface PriorFlag {
  /** ISO date of the FIRST overshoot flag in the lookback window. */
  firstFlaggedAt: string;
  /** Fractional return from that edition's close to the latest close. */
  returnSince: number | null;
}

/**
 * Context line for a name flagged in an earlier edition.
 *
 * The framework re-flags a name for as long as its 5-session window still
 * spans the fall — which is correct, but means an edition can re-advertise an
 * overshoot AFTER the bounce it called has already happened (live case: SNDK
 * re-flagged strong_overshoot on 3 Aug, having risen ~34% since its 29 Jul
 * flag). Stating the move since the first flag is CONTEXT, not a score: it
 * changes no weight and no band, it just stops the repeat reading as a fresh
 * call. Pure; exported for tests. Impersonal (I2) — no entry/exit language.
 */
export function describeRepeatFlag(prior: PriorFlag | null): string {
  if (!prior) return "";
  const when = formatPriceDate(prior.firstFlaggedAt);
  if (prior.returnSince == null) {
    return ` First flagged ${when}.`;
  }
  const pct = `${prior.returnSince >= 0 ? "+" : ""}${(prior.returnSince * 100).toFixed(1)}%`;
  return ` First flagged ${when}; ${pct} since.`;
}

/**
 * Which move does a verdict quote? The leg of the screen the name actually
 * cleared — NOT unconditionally the 5-session number. A name that qualified on
 * the 1-day leg can have a POSITIVE 5-session return (it rallied, then fell
 * hard today), and quoting that read as nonsense in filed reports: "the
 * framework grades +4.1% over 5 sessions … as proportionate" (LITE, 27 Jul).
 * When both legs cleared, quote the more severe. Pure; exported for tests.
 */
export function describeScreenedMove(
  stats: DropStats | null,
  thresholds: InclusionThresholds = DEFAULT_THRESHOLDS,
  runDate?: string | null,
): string {
  const r5 = stats?.return5d ?? null;
  const r1 = stats?.return1d ?? null;
  const fell5 = r5 !== null && r5 <= -thresholds.drawdown5dPct / 100;
  const fell1 = r1 !== null && r1 <= -thresholds.drop1dPct / 100;
  // Stale-print stamp: when the newest close feeding these returns predates
  // the run, "-9.0% in a session" reads to a reader of TODAY's edition as if
  // the fall happened today. It didn't — say which close it came from. (Live
  // case: AZN's 3 Aug fall was graded in the 4 Aug edition because its 4 Aug
  // close hadn't landed.)
  const asOf = stats?.asOf ?? null;
  const stamp =
    asOf && runDate && asOf < runDate ? ` (as of the ${formatPriceDate(asOf)} close)` : "";
  const day = (v: number) => `${(v * 100).toFixed(1)}% in a session${stamp}`;
  const week = (v: number) => `${(v * 100).toFixed(1)}% over 5 sessions${stamp}`;

  if (fell5 && fell1) return r5! <= r1! ? week(r5!) : day(r1!);
  if (fell5) return week(r5!);
  if (fell1) return day(r1!);
  // Nothing cleared (defensive — scored names cleared by construction):
  // quote the worse actual move rather than a rise.
  if (r5 !== null && r1 !== null) return r5 <= r1 ? week(r5) : day(r1);
  if (r5 !== null) return week(r5);
  if (r1 !== null) return day(r1);
  return "the screened decline";
}

/** Pure verdict banding — exported for tests. Impersonal language (I2). */
export function classifyReaction(
  scored: CandidateScore,
  stats: DropStats | null,
  grade: ReactionNewsGrade | null = null,
  thresholds: InclusionThresholds = DEFAULT_THRESHOLDS,
  context: {
    /** The run's date — enables the stale-print stamp. */
    runDate?: string | null;
    /** Set when this name was flagged in an earlier edition. */
    priorFlag?: PriorFlag | null;
  } = {},
): { verdict: string; classification: ReactionClassification } {
  if (scored.coverage < MIN_COVERAGE_TO_CLASSIFY) {
    return {
      classification: "insufficient_data",
      verdict: `Only ${Math.round(scored.coverage * 100)}% of framework weight had data — verdict withheld rather than guessed.`,
    };
  }

  const move = describeScreenedMove(stats, thresholds, context.runDate);
  const repeat = describeRepeatFlag(context.priorFlag ?? null);

  // Before any overshoot call: did the shares actually fall? A split or
  // consolidation in an unadjusted series looks exactly like a catastrophic
  // drop on no news, which is the shape the framework scores highest. The
  // move isn't disproportionate to the news — it didn't happen.
  if (grade && grade.corporateAction !== "none") {
    return {
      classification: "corporate_action",
      verdict:
        grade.corporateAction === "confirmed"
          ? `The ${move} reflects a corporate action, not a loss of value — ${grade.headline} No overshoot verdict is filed.`
          : `The ${move} has the shape of a corporate action rather than a loss of value, though no source confirms it — ${grade.headline} No overshoot verdict is filed.`,
    };
  }

  const damage = scored.criteria["earned_damage"]?.signals?.["news_damage_severity"]?.raw;

  // "Overshoot" MEANS "fell further than the news justifies" — without a news
  // grade the claim is unsupported and the remaining price signals are
  // circular (a big drop "proving" a big overshoot). Name the gap instead of
  // banding the composite.
  if (damage == null) {
    return {
      classification: "cause_unconfirmed",
      verdict: `${move} cleared the screen, but no news grade is available this run — whether the move is disproportionate cannot be assessed.`,
    };
  }
  const damageNote = ` against news damage graded ${Math.round(damage)}/100`;

  if (scored.composite >= BANDS.strongOvershootMin) {
    return {
      classification: "strong_overshoot",
      verdict: `The framework grades ${move}${damageNote} as strongly disproportionate.${repeat}`,
    };
  }
  if (scored.composite >= BANDS.mildOvershootMin) {
    return {
      classification: "mild_overshoot",
      verdict: `The framework grades ${move}${damageNote} as somewhat disproportionate.${repeat}`,
    };
  }
  if (scored.composite >= BANDS.proportionateMin) {
    return {
      classification: "proportionate",
      verdict: `The framework grades ${move}${damageNote} as broadly in line with the identified cause.${repeat}`,
    };
  }
  return {
    classification: "underreaction",
    verdict: `The framework grades the identified damage as heavier than ${move} reflects.${repeat}`,
  };
}

export const reactionAgent = new ReactionAgent();
