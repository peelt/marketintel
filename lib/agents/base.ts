import type {
  Agent,
  AgentMeta,
  AgentRunInput,
  EvidenceItem,
  RankedReport,
  ScoredCandidate,
  ScoringFramework,
} from "./types";
import type { CandidateScore, SignalResolverRegistry } from "@/lib/scoring/types";
import { scoreCandidates } from "@/lib/scoring/engine";
import {
  getActiveFramework,
  getFrameworkById,
} from "@/lib/scoring/frameworks-repository";

/**
 * BaseAgent declares the lifecycle every pole follows. Concrete agents extend
 * this class and override three methods:
 *
 *   collectCandidates() — return the security UUIDs to score
 *   getResolver()       — return the SignalResolver that maps source_query
 *                         strings to numeric values + evidence
 *   composeReport()     — produce the human-readable markdown body from the
 *                         ranked scores
 *
 * The base class handles framework lookup, scoring orchestration, evidence
 * aggregation, and report assembly. Persistence is separate (see
 * lib/agents/persist-report.ts) — agent.run() returns an in-memory
 * RankedReport; the caller decides whether and where to persist.
 */
export abstract class BaseAgent implements Agent {
  abstract readonly meta: AgentMeta;

  protected abstract collectCandidates(
    framework: ScoringFramework,
    input: AgentRunInput,
  ): Promise<string[]>;

  protected abstract getResolver(
    framework: ScoringFramework,
  ): SignalResolverRegistry;

  protected abstract composeReport(input: {
    framework: ScoringFramework;
    scored: CandidateScore[];
    evidence: EvidenceItem[];
  }): Promise<{ summaryMarkdown: string; bodyMarkdown: string }>;

  /**
   * Optional verdict hook. Agents whose output is a labelled call — Metals'
   * buy/hold/avoid, Reaction's overshoot bands — map a candidate's scores to
   * `verdict` (free text) and/or `classification` (constrained vocabulary)
   * here. Default: no verdict. Both flow through to `report_items`.
   */
  protected classify(_scored: CandidateScore): {
    verdict?: string | null;
    classification?: string | null;
  } {
    return {};
  }

  /**
   * Coverage share (0–1) below which a candidate's composite is considered
   * too thinly evidenced to compete for rank. Agents that withhold
   * classification under a floor set the same value here so ranking and
   * classification agree. Default 0 = pure composite order.
   */
  protected coverageFloor = 0;

  async run(input: AgentRunInput): Promise<RankedReport> {
    const framework = await this.resolveFramework(input);
    if (!framework) {
      throw new Error(
        `no active scoring framework for ${this.meta.name}; seed one before running`,
      );
    }

    const candidates = await this.collectCandidates(framework, input);
    if (candidates.length === 0) {
      // Empty universe is a real outcome, not an error. Persist a stub report
      // so the dashboard reflects the run.
      const stubSummary = `_No candidates passed the ${this.meta.displayName} screen this run._`;
      return {
        agentName: this.meta.name,
        generatedAt: new Date().toISOString(),
        summaryMarkdown: stubSummary,
        bodyMarkdown: `# ${this.meta.displayName}\n\n${stubSummary}`,
        ranked: [],
        evidence: [],
      };
    }

    const resolver = this.getResolver(framework);
    const scored = orderForRanking(
      await scoreCandidates({
        framework,
        candidates,
        resolver,
      }),
      this.coverageFloor,
    );

    const ranked: ScoredCandidate[] = scored.map((s, idx) => {
      // Build evidence index map: the candidate's evidence items get global
      // indices that the markdown can reference by [^1], [^2] etc.
      const evidenceStartIndex = scored
        .slice(0, idx)
        .reduce((sum, prev) => sum + prev.evidence.length, 0);
      const { verdict, classification } = this.classify(s);
      return {
        securityId: s.securityId,
        composite: roundTo(s.composite, 1),
        coverage: roundTo(s.coverage, 3),
        verdict: verdict ?? null,
        classification: classification ?? null,
        breakdown: Object.fromEntries(
          Object.entries(s.criteria).map(([k, v]) => [
            k,
            {
              // null stays null — "no data" must never render as "worst".
              score: v.score === null ? null : roundTo(v.score, 1),
              signals: Object.fromEntries(
                Object.entries(v.signals).map(([sk, sv]) => [
                  sk,
                  sv.normalised === null ? null : roundTo(sv.normalised, 1),
                ]),
              ),
            },
          ]),
        ),
        evidenceRefs: s.evidence.map(
          (_, evIdx) => evidenceStartIndex + evIdx,
        ),
      };
    });

    const flatEvidence: EvidenceItem[] = scored.flatMap((s) => s.evidence);

    const composed = await this.composeReport({
      framework,
      scored,
      evidence: flatEvidence,
    });

    return {
      agentName: this.meta.name,
      generatedAt: new Date().toISOString(),
      summaryMarkdown: composed.summaryMarkdown,
      bodyMarkdown: composed.bodyMarkdown,
      ranked,
      evidence: flatEvidence,
    };
  }

  private async resolveFramework(
    input: AgentRunInput,
  ): Promise<ScoringFramework | null> {
    if (input.frameworkId) {
      return getFrameworkById(input.frameworkId);
    }
    return getActiveFramework(this.meta.name);
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Rank order for a report: candidates the agent can actually classify
 * (coverage at or above the floor) come first, composite-descending within
 * each group. A below-floor composite is computed from a sliver of the
 * framework — a name carrying only its yield signal can post a "perfect"
 * redistributed composite — so letting it outrank fully-evidenced names turns
 * missing data into a leaderboard advantage ("missing = winner"), the mirror
 * image of the missing-≠-zero invariant. Exported for unit tests.
 */
export function orderForRanking<T extends { composite: number; coverage: number }>(
  scored: T[],
  coverageFloor: number,
): T[] {
  return [...scored].sort((a, b) => {
    const aBelow = a.coverage < coverageFloor ? 1 : 0;
    const bBelow = b.coverage < coverageFloor ? 1 : 0;
    if (aBelow !== bBelow) return aBelow - bBelow;
    return b.composite - a.composite;
  });
}
