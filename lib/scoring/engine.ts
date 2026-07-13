import { normaliseValues } from "./normalise";
import type {
  CandidateScore,
  ScoringRunInput,
  SignalValue,
} from "./types";
import type { EvidenceItem } from "@/lib/agents/types";

/**
 * Score a set of candidates against a framework.
 *
 * For each (criterion × sub-signal), the engine resolves the raw value for
 * every candidate, normalises across the candidate set, weights, and
 * aggregates. Evidence accumulates per candidate as resolvers return it.
 *
 * Critically: no LLM calls happen here. Quantitative signals are resolver-
 * supplied numbers. The LLM scoring path lives in lib/scoring/llm-scorer.ts
 * and registers itself as a special resolver that an agent can plug in for
 * qualitative criteria.
 */
export async function scoreCandidates(
  input: ScoringRunInput,
): Promise<CandidateScore[]> {
  const { framework, candidates, resolver } = input;

  const scores = new Map<string, CandidateScore>();
  for (const securityId of candidates) {
    scores.set(securityId, {
      securityId,
      composite: 0,
      criteria: {},
      evidence: [],
    });
  }

  for (const criterion of framework.criteria) {
    // Resolve every sub-signal for every candidate.
    const subResults: {
      signalKey: string;
      weight: number;
      direction: "higher_better" | "lower_better";
      values: { securityId: string; value: SignalValue }[];
    }[] = [];

    for (const sub of criterion.subSignals) {
      const values: { securityId: string; value: SignalValue }[] = [];
      for (const securityId of candidates) {
        const value = await resolver.resolve({
          securityId,
          sourceQuery: sub.sourceQuery,
        });
        values.push({ securityId, value });
      }
      subResults.push({
        signalKey: sub.key,
        weight: sub.weight,
        direction: sub.direction,
        values,
      });
    }

    // Normalise each sub-signal across candidates, then aggregate per candidate.
    const normalisedBySignal = new Map<string, Map<string, number | null>>();
    for (const sub of subResults) {
      const raws = sub.values.map((v) => v.value.raw);
      const normalised = normaliseValues(raws, sub.direction);
      const m = new Map<string, number | null>();
      sub.values.forEach((v, i) => m.set(v.securityId, normalised[i]));
      normalisedBySignal.set(sub.signalKey, m);
    }

    for (const securityId of candidates) {
      const candidateScore = scores.get(securityId)!;
      const signalBreakdown: Record<
        string,
        { raw: number | null; normalised: number | null; weight: number }
      > = {};

      let weighted = 0;
      let weightAccountedFor = 0;
      for (const sub of subResults) {
        const raw = sub.values.find((v) => v.securityId === securityId)?.value
          .raw ?? null;
        const normalised =
          normalisedBySignal.get(sub.signalKey)?.get(securityId) ?? null;
        signalBreakdown[sub.signalKey] = {
          raw,
          normalised,
          weight: sub.weight,
        };
        if (normalised !== null) {
          weighted += normalised * sub.weight;
          weightAccountedFor += sub.weight;
        }
      }

      const criterionScore =
        weightAccountedFor > 0 ? weighted / weightAccountedFor : 0;

      candidateScore.criteria[criterion.key] = {
        score: criterionScore,
        signals: signalBreakdown,
      };
      candidateScore.composite += criterionScore * criterion.weight;

      // Collect evidence from every sub-signal we resolved for this candidate.
      for (const sub of subResults) {
        const hit = sub.values.find((v) => v.securityId === securityId);
        if (!hit) continue;
        for (const ev of hit.value.evidence) {
          candidateScore.evidence.push(scaleEvidenceWeight(ev, sub.weight * criterion.weight));
        }
      }
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.composite - a.composite);
}

function scaleEvidenceWeight(ev: EvidenceItem, scale: number): EvidenceItem {
  return { ...ev, weight: Math.max(0, Math.min(1, ev.weight * scale)) };
}
