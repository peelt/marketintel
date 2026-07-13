import { describe, expect, it } from "vitest";
import { scoreCandidates } from "@/lib/scoring/engine";
import type { SignalValue, SignalResolverRegistry } from "@/lib/scoring/types";
import type { ScoringFramework, EvidenceItem } from "@/lib/agents/types";

/** Resolver backed by a lookup table: table[sourceQuery][securityId] = raw. */
function tableResolver(
  table: Record<string, Record<string, number | null>>,
  evidence: Record<string, EvidenceItem[]> = {},
): SignalResolverRegistry {
  return {
    resolve: async ({ securityId, sourceQuery }): Promise<SignalValue> => ({
      raw: table[sourceQuery]?.[securityId] ?? null,
      evidence: evidence[securityId] ?? [],
    }),
  };
}

function framework(criteria: ScoringFramework["criteria"]): ScoringFramework {
  return { id: "fw-1", agentName: "dividend", version: 1, criteria };
}

const A = "sec-a";
const B = "sec-b";

describe("scoreCandidates", () => {
  it("weights sub-signals and criteria into the composite", async () => {
    const fw = framework([
      {
        key: "c1",
        weight: 0.6,
        subSignals: [
          { key: "s1", weight: 1, direction: "higher_better", sourceQuery: "q1", normalisation: "absolute" },
        ],
      },
      {
        key: "c2",
        weight: 0.4,
        subSignals: [
          { key: "s2", weight: 1, direction: "higher_better", sourceQuery: "q2", normalisation: "absolute" },
        ],
      },
    ]);
    const resolver = tableResolver({
      q1: { [A]: 80, [B]: 40 },
      q2: { [A]: 50, [B]: 100 },
    });

    const scored = await scoreCandidates({ framework: fw, candidates: [A, B], resolver });
    const a = scored.find((s) => s.securityId === A)!;
    const b = scored.find((s) => s.securityId === B)!;

    expect(a.composite).toBeCloseTo(0.6 * 80 + 0.4 * 50); // 68
    expect(b.composite).toBeCloseTo(0.6 * 40 + 0.4 * 100); // 64
    expect(scored[0].securityId).toBe(A); // sorted best-first
    expect(a.coverage).toBeCloseTo(1);
  });

  it("redistributes a null SUB-SIGNAL's weight within its criterion", async () => {
    const fw = framework([
      {
        key: "c1",
        weight: 1,
        subSignals: [
          { key: "s1", weight: 0.75, direction: "higher_better", sourceQuery: "q1", normalisation: "absolute" },
          { key: "s2", weight: 0.25, direction: "higher_better", sourceQuery: "q2", normalisation: "absolute" },
        ],
      },
    ]);
    // A has no q2 value: s1 carries the whole criterion.
    const resolver = tableResolver({ q1: { [A]: 60 }, q2: { [A]: null } });

    const [a] = await scoreCandidates({ framework: fw, candidates: [A], resolver });
    expect(a.criteria.c1.score).toBeCloseTo(60);
    expect(a.coverage).toBeCloseTo(0.75);
    expect(a.criteria.c1.signals.s2.normalised).toBeNull();
  });

  it("redistributes a fully-null CRITERION's weight instead of scoring it 0", async () => {
    const fw = framework([
      {
        key: "has-data",
        weight: 0.5,
        subSignals: [
          { key: "s1", weight: 1, direction: "higher_better", sourceQuery: "q1", normalisation: "absolute" },
        ],
      },
      {
        key: "no-data",
        weight: 0.5,
        subSignals: [
          { key: "s2", weight: 1, direction: "higher_better", sourceQuery: "q2", normalisation: "absolute" },
        ],
      },
    ]);
    const resolver = tableResolver({ q1: { [A]: 80 }, q2: { [A]: null } });

    const [a] = await scoreCandidates({ framework: fw, candidates: [A], resolver });
    // Old behaviour: 0.5*80 + 0.5*0 = 40. New: missing criterion is null and
    // its weight redistributes → composite stays 80, coverage exposes the gap.
    expect(a.criteria["no-data"].score).toBeNull();
    expect(a.composite).toBeCloseTo(80);
    expect(a.coverage).toBeCloseTo(0.5);
  });

  it("candidate with zero data scores composite 0 with coverage 0", async () => {
    const fw = framework([
      {
        key: "c1",
        weight: 1,
        subSignals: [
          { key: "s1", weight: 1, direction: "higher_better", sourceQuery: "q1" },
        ],
      },
    ]);
    const resolver = tableResolver({ q1: { [A]: null } });
    const [a] = await scoreCandidates({ framework: fw, candidates: [A], resolver });
    expect(a.composite).toBe(0);
    expect(a.coverage).toBe(0);
    expect(a.criteria.c1.score).toBeNull();
  });

  it("carries evidence through with the resolver's own weight (no framework-weight crush)", async () => {
    const fw = framework([
      {
        key: "c1",
        weight: 0.5, // would have crushed evidence weight to ≤0.125 before
        subSignals: [
          { key: "s1", weight: 0.25, direction: "higher_better", sourceQuery: "q1", normalisation: "absolute" },
          { key: "s2", weight: 0.75, direction: "higher_better", sourceQuery: "q2", normalisation: "absolute" },
        ],
      },
      {
        key: "c2",
        weight: 0.5,
        subSignals: [
          { key: "s3", weight: 1, direction: "higher_better", sourceQuery: "q3", normalisation: "absolute" },
        ],
      },
    ]);
    const ev: EvidenceItem = {
      type: "derived_metric",
      sourceTable: "financials_snapshot",
      sourceId: "row-1",
      text: "payout ratio 45%",
      weight: 0.8,
    };
    const resolver = tableResolver(
      { q1: { [A]: 10 }, q2: { [A]: 20 }, q3: { [A]: 30 } },
      { [A]: [ev] },
    );

    const [a] = await scoreCandidates({ framework: fw, candidates: [A], resolver });
    expect(a.evidence.length).toBe(3); // one per resolved sub-signal
    for (const item of a.evidence) {
      expect(item.weight).toBeCloseTo(0.8); // NOT 0.8 × subWeight × critWeight
    }
  });

  it("prefers the batch resolver when provided and treats missing entries as null", async () => {
    let batchCalls = 0;
    let singleCalls = 0;
    const resolver: SignalResolverRegistry = {
      resolve: async () => {
        singleCalls++;
        return { raw: 1, evidence: [] };
      },
      resolveBatch: async ({ securityIds }) => {
        batchCalls++;
        const m = new Map<string, SignalValue>();
        m.set(securityIds[0], { raw: 90, evidence: [] });
        // securityIds[1] deliberately omitted → must resolve to null signal.
        return m;
      },
    };
    const fw = framework([
      {
        key: "c1",
        weight: 1,
        subSignals: [
          { key: "s1", weight: 1, direction: "higher_better", sourceQuery: "q1", normalisation: "absolute" },
        ],
      },
    ]);

    const scored = await scoreCandidates({ framework: fw, candidates: [A, B], resolver });
    expect(batchCalls).toBe(1);
    expect(singleCalls).toBe(0);
    const a = scored.find((s) => s.securityId === A)!;
    const b = scored.find((s) => s.securityId === B)!;
    expect(a.composite).toBeCloseTo(90);
    expect(b.coverage).toBe(0);
    expect(b.criteria.c1.signals.s1.raw).toBeNull();
  });

  it("rank normalisation is relative while absolute is not (the §6 caveat)", async () => {
    const weakField = { [A]: 20, [B]: 30 }; // both weak on a 0–100 rubric
    const fwRank = framework([
      {
        key: "c1",
        weight: 1,
        subSignals: [
          { key: "s1", weight: 1, direction: "higher_better", sourceQuery: "q1", normalisation: "rank" },
        ],
      },
    ]);
    const fwAbs = framework([
      {
        key: "c1",
        weight: 1,
        subSignals: [
          { key: "s1", weight: 1, direction: "higher_better", sourceQuery: "q1", normalisation: "absolute" },
        ],
      },
    ]);
    const resolver = tableResolver({ q1: weakField });

    const rank = await scoreCandidates({ framework: fwRank, candidates: [A, B], resolver });
    const abs = await scoreCandidates({ framework: fwAbs, candidates: [A, B], resolver });

    // Rank: the best-of-a-bad-bunch reads 100.
    expect(rank.find((s) => s.securityId === B)!.composite).toBeCloseTo(100);
    // Absolute: weak stays weak.
    expect(abs.find((s) => s.securityId === B)!.composite).toBeCloseTo(30);
  });
});
