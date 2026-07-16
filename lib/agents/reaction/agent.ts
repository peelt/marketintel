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

  protected async collectCandidates(
    framework: ScoringFramework,
    _input: AgentRunInput,
  ): Promise<string[]> {
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

    return capped.map((u) => u.id);
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
      `Inclusion: 5-session drawdown or 1-session drop past the framework's thresholds (v${framework.version} params). Each name is then scored on **overshoot-ness** — excess decline vs the market, the earned damage identified in current news (web-researched, graded 0–100 absolute), balance-sheet resilience, and how deep the repricing runs. Higher composite = more disproportionate move. Missing data redistributes weight and shows as coverage, never as zero.`,
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
