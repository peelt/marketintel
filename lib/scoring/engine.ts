import { normaliseValues } from "./normalise";
import type {
  CandidateScore,
  ScoringRunInput,
  SignalValue,
  SignalResolverRegistry,
} from "./types";
import type { EvidenceItem } from "@/lib/agents/types";

/**
 * Score a set of candidates against a framework.
 *
 * For each (criterion × sub-signal), the engine resolves the raw value for
 * every candidate, normalises per the sub-signal's declared mode (rank /
 * zscore / absolute), weights, and aggregates. Evidence accumulates per
 * candidate as resolvers return it.
 *
 * Null semantics — consistent at every level:
 *   - a null SIGNAL redistributes its weight across the criterion's present
 *     signals;
 *   - a fully-null CRITERION redistributes its weight across the candidate's
 *     present criteria (it is NOT scored as zero);
 *   - per-candidate `coverage` records how much framework weight actually had
 *     data, so a thin composite is visibly thin.
 *
 * Evidence weights are the resolver's own 0–1 confidence, clamped — they are
 * NOT multiplied by framework weights (that crushed everything to ≤0.25 and
 * made all evidence read as unimportant).
 *
 * No LLM calls happen here. Quantitative signals are resolver-supplied
 * numbers. The LLM scoring path lives in lib/scoring/llm-scorer.ts and plugs
 * in through an agent's resolver (with normalisation: "absolute").
 */
export async function scoreCandidates(
  input: ScoringRunInput,
): Promise<CandidateScore[]> {
  const { framework, candidates, resolver } = input;

  const scores = new Map<string, CandidateScore>();
  const acc = new Map<
    string,
    { weighted: number; weightAccounted: number; coverage: number }
  >();
  for (const securityId of candidates) {
    scores.set(securityId, {
      securityId,
      composite: 0,
      coverage: 0,
      criteria: {},
      evidence: [],
    });
    acc.set(securityId, { weighted: 0, weightAccounted: 0, coverage: 0 });
  }

  for (const criterion of framework.criteria) {
    // Resolve every sub-signal for every candidate.
    const subResults: {
      signalKey: string;
      weight: number;
      direction: "higher_better" | "lower_better";
      values: Map<string, SignalValue>;
    }[] = [];

    for (const sub of criterion.subSignals) {
      const values = await resolveSignal(resolver, candidates, sub.sourceQuery);
      subResults.push({
        signalKey: sub.key,
        weight: sub.weight,
        direction: sub.direction,
        values,
      });
    }

    // Normalise each sub-signal across candidates per its declared mode.
    const normalisedBySignal = new Map<string, Map<string, number | null>>();
    for (let i = 0; i < criterion.subSignals.length; i++) {
      const sub = subResults[i];
      const raws = candidates.map((id) => sub.values.get(id)?.raw ?? null);
      const normalised = normaliseValues(
        raws,
        sub.direction,
        criterion.subSignals[i].normalisation ?? "rank",
      );
      const m = new Map<string, number | null>();
      candidates.forEach((id, idx) => m.set(id, normalised[idx]));
      normalisedBySignal.set(sub.signalKey, m);
    }

    for (const securityId of candidates) {
      const candidateScore = scores.get(securityId)!;
      const candidateAcc = acc.get(securityId)!;
      const signalBreakdown: Record<
        string,
        { raw: number | null; normalised: number | null; weight: number }
      > = {};

      let weighted = 0;
      let weightAccountedFor = 0;
      for (const sub of subResults) {
        const raw = sub.values.get(securityId)?.raw ?? null;
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

      // null, not zero, when the criterion had no data at all.
      const criterionScore =
        weightAccountedFor > 0 ? weighted / weightAccountedFor : null;

      candidateScore.criteria[criterion.key] = {
        score: criterionScore,
        signals: signalBreakdown,
      };
      if (criterionScore !== null) {
        candidateAcc.weighted += criterionScore * criterion.weight;
        candidateAcc.weightAccounted += criterion.weight;
      }
      // Sub-signal weights sum to 1 within a criterion, so this is the share
      // of this criterion's weight that had data.
      candidateAcc.coverage += criterion.weight * weightAccountedFor;

      // Collect evidence from every sub-signal resolved for this candidate.
      for (const sub of subResults) {
        const hit = sub.values.get(securityId);
        if (!hit) continue;
        for (const ev of hit.evidence) {
          candidateScore.evidence.push(clampEvidenceWeight(ev));
        }
      }
    }
  }

  for (const securityId of candidates) {
    const s = scores.get(securityId)!;
    const a = acc.get(securityId)!;
    // Redistribute missing-criterion weight rather than scoring it as worst.
    s.composite = a.weightAccounted > 0 ? a.weighted / a.weightAccounted : 0;
    s.coverage = Math.min(1, Math.max(0, a.coverage));
  }

  return Array.from(scores.values()).sort((a, b) => b.composite - a.composite);
}

/** Prefer the batch path when the resolver provides one. */
async function resolveSignal(
  resolver: SignalResolverRegistry,
  candidates: string[],
  sourceQuery: string,
): Promise<Map<string, SignalValue>> {
  if (resolver.resolveBatch) {
    const batch = await resolver.resolveBatch({
      securityIds: candidates,
      sourceQuery,
    });
    // Guarantee an entry per candidate so downstream lookups are total.
    const out = new Map<string, SignalValue>();
    for (const id of candidates) {
      out.set(id, batch.get(id) ?? { raw: null, evidence: [] });
    }
    return out;
  }

  const out = new Map<string, SignalValue>();
  for (const securityId of candidates) {
    out.set(securityId, await resolver.resolve({ securityId, sourceQuery }));
  }
  return out;
}

/**
 * Evidence weight is the resolver's own confidence in the source, clamped to
 * the DB constraint. Framework importance-weighting stays in the score, where
 * it belongs — multiplying it into evidence weight crushed every row to noise.
 */
function clampEvidenceWeight(ev: EvidenceItem): EvidenceItem {
  return { ...ev, weight: Math.max(0, Math.min(1, ev.weight)) };
}
