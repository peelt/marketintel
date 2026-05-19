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
    const scored = await scoreCandidates({
      framework,
      candidates,
      resolver,
    });

    const ranked: ScoredCandidate[] = scored.map((s, idx) => {
      // Build evidence index map: the candidate's evidence items get global
      // indices that the markdown can reference by [^1], [^2] etc.
      const evidenceStartIndex = scored
        .slice(0, idx)
        .reduce((sum, prev) => sum + prev.evidence.length, 0);
      return {
        securityId: s.securityId,
        composite: roundTo(s.composite, 1),
        breakdown: Object.fromEntries(
          Object.entries(s.criteria).map(([k, v]) => [
            k,
            {
              score: roundTo(v.score, 1),
              signals: Object.fromEntries(
                Object.entries(v.signals).map(([sk, sv]) => [
                  sk,
                  sv.normalised ?? 0,
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
