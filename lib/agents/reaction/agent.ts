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
  dropSeverity,
  dropStats,
  median,
  passesDropScreen,
  thresholdsFromParams,
  type DropStats,
} from "./metrics";
import { createReactionResolver, type ReactionRunContext } from "./resolvers";

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
   */
  protected override demoteFromRanking(scored: CandidateScore): boolean {
    if (scored.coverage < this.coverageFloor) return true;
    return (
      scored.criteria["earned_damage"]?.signals?.["news_damage_severity"]?.raw ==
      null
    );
  }

  private ctx: ReactionRunContext | null = null;
  private screenSummary = { universe: 0, screened: 0, capped: 0 };
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
    const thresholds = thresholdsFromParams(framework.params);
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

    this.ctx = {
      securities: new Map(universe.map((u) => [u.id, u])),
      screenSeries: series,
      stats,
      universeMedian5d: median(all5d),
      asOf: new Date().toISOString().slice(0, 10),
    };

    // On-demand mode: the user asked about specific names. Screen them like
    // any other name; if one qualifies, force it into the (full) cohort so
    // it's graded in real peer context; if none qualifies, skip scoring and
    // let emptySummary() answer factually about the requested names.
    const requested = (input.tickers ?? [])
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
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
      if (requiredIds.length === 0) return [];
      return mergeRequestedIntoCohort(
        capped.map((u) => u.id),
        requiredIds,
      );
    }

    return capped.map((u) => u.id);
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
    return classifyReaction(scored, this.ctx?.stats.get(scored.securityId) ?? null);
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
      ...classifyReaction(s, this.ctx?.stats.get(s.securityId) ?? null),
    }));

    const overshoots = classified.filter(
      (c) =>
        c.classification === "strong_overshoot" ||
        c.classification === "mild_overshoot",
    );
    const unconfirmed = classified.filter(
      (c) => c.classification === "cause_unconfirmed",
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
    ]
      .filter(Boolean)
      .join(" ");

    const lines: string[] = [
      `# Reaction Analyser`,
      ``,
      summaryMarkdown,
      ``,
      `## How this is scored`,
      ``,
      `Inclusion: 5-session drawdown or 1-session drop past the framework's thresholds (v${framework.version} params). Each name is then scored on **overshoot-ness** — excess decline vs the market, the earned damage identified in current news (web-researched, graded 0–100 absolute), and how deep the repricing runs. Higher composite = more disproportionate move. Missing data redistributes weight and shows as coverage, never as zero.`,
      ``,
    ];

    if (scored.length > 0) {
      lines.push(`## Verdicts`, ``);
      for (const c of classified) {
        lines.push(
          `- **${label(c.s)}** — ${String(c.classification).replace(/_/g, " ")} (composite ${c.s.composite.toFixed(1)}, coverage ${Math.round(c.s.coverage * 100)}%). ${c.verdict ?? ""}`,
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

/** Pure verdict banding — exported for tests. Impersonal language (I2). */
export function classifyReaction(
  scored: CandidateScore,
  stats: DropStats | null,
): { verdict: string; classification: ReactionClassification } {
  if (scored.coverage < MIN_COVERAGE_TO_CLASSIFY) {
    return {
      classification: "insufficient_data",
      verdict: `Only ${Math.round(scored.coverage * 100)}% of framework weight had data — verdict withheld rather than guessed.`,
    };
  }

  const move =
    stats?.return5d != null
      ? `${(stats.return5d * 100).toFixed(1)}% over 5 sessions`
      : stats?.return1d != null
        ? `${(stats.return1d * 100).toFixed(1)}% in a session`
        : "the screened decline";
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
      verdict: `The framework grades ${move}${damageNote} as strongly disproportionate.`,
    };
  }
  if (scored.composite >= BANDS.mildOvershootMin) {
    return {
      classification: "mild_overshoot",
      verdict: `The framework grades ${move}${damageNote} as somewhat disproportionate.`,
    };
  }
  if (scored.composite >= BANDS.proportionateMin) {
    return {
      classification: "proportionate",
      verdict: `The framework grades ${move}${damageNote} as broadly in line with the identified cause.`,
    };
  }
  return {
    classification: "underreaction",
    verdict: `The framework grades the identified damage as heavier than ${move} reflects.`,
  };
}

export const reactionAgent = new ReactionAgent();
