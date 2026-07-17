import { describe, expect, it } from "vitest";
import {
  classifyMetals,
  fcfYield,
  rsVsBenchmark,
} from "@/lib/agents/metals/metrics";
import { parseMetalsGrade } from "@/lib/agents/metals/research";
import { isFresh } from "@/lib/agents/metals/research-cache";
import { parseNewsEvidence } from "@/lib/format";
import type { CandidateScore } from "@/lib/scoring/types";

function scored(overrides: {
  coverage?: number;
  cost?: number | null;
  debt?: number | null;
  fcf?: number | null;
  discount?: number | null;
}): CandidateScore {
  const { coverage = 0.8, cost = 70, debt = 1.0, fcf = 0.04, discount = 0.2 } = overrides;
  return {
    securityId: "s1",
    composite: 50, // deliberately mid — the composite must NOT drive labels
    coverage,
    criteria: {
      cost_position: {
        score: 70,
        signals: { aisc_margin_grade: { raw: cost, normalised: cost, weight: 1 } },
      },
      balance_sheet: {
        score: 50,
        signals: {
          debt_to_ebitda_ttm: { raw: debt, normalised: 50, weight: 0.5 },
          fcf_yield_ttm: { raw: fcf, normalised: 50, weight: 0.5 },
        },
      },
      valuation_vs_history: {
        score: 50,
        signals: {
          discount_to_52w_high: { raw: discount, normalised: 50, weight: 0.6 },
        },
      },
    },
    evidence: [],
  };
}

describe("metals metrics", () => {
  it("rsVsBenchmark is the spread, null-safe", () => {
    expect(rsVsBenchmark(0.1, 0.04)).toBeCloseTo(0.06);
    expect(rsVsBenchmark(null, 0.04)).toBeNull();
    expect(rsVsBenchmark(0.1, null)).toBeNull();
  });

  it("fcfYield needs a positive market cap", () => {
    expect(fcfYield(500, 10_000)).toBeCloseTo(0.05);
    expect(fcfYield(500, 0)).toBeNull();
    expect(fcfYield(null, 10_000)).toBeNull();
  });
});

describe("classifyMetals — absolute facts, never the blended composite", () => {
  it("labels a strong cost position with a clean balance sheet well_positioned", () => {
    const c = classifyMetals(scored({ cost: 82, debt: 0.8, fcf: 0.05 }));
    expect(c.classification).toBe("well_positioned");
    expect(c.verdict).toContain("82/100");
  });

  it("a premier miner near its 52w high must NOT be vulnerable (the live v1 failure)", () => {
    // Strong absolute facts + zero price discount — v1 mislabelled this.
    const c = classifyMetals(scored({ cost: 75, debt: 0.5, fcf: 0.06, discount: 0.02 }));
    expect(c.classification).toBe("well_positioned");
  });

  it("vulnerable requires an absolute reason: thin margin, stretched debt, or cash burn", () => {
    expect(classifyMetals(scored({ cost: 30 })).classification).toBe("vulnerable");
    expect(classifyMetals(scored({ cost: 75, debt: 4.2 })).classification).toBe("vulnerable");
    expect(classifyMetals(scored({ cost: 50, fcf: -0.03 })).classification).toBe("vulnerable");
    // strong cost + cash burn is mixed, not vulnerable
    expect(classifyMetals(scored({ cost: 75, fcf: -0.03 })).classification).toBe("mixed");
  });

  it("middling facts are mixed", () => {
    expect(classifyMetals(scored({ cost: 60 })).classification).toBe("mixed");
  });

  it("valuation is factual context in the verdict, never the judgment", () => {
    const c = classifyMetals(scored({ cost: 82, debt: 0.8, discount: 0.35 }));
    expect(c.verdict).toContain("35% below its trailing-year high");
    expect(c.classification).toBe("well_positioned");
  });

  it("withholds below the coverage floor", () => {
    const c = classifyMetals(scored({ coverage: 0.2 }));
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("withheld");
  });

  it("withholds when the cost grade is missing — price action alone must not label", () => {
    const c = classifyMetals(scored({ cost: null }));
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("No current cost disclosure");
  });

  it("verdict text is factual and impersonal (I2)", () => {
    const c = classifyMetals(scored({ cost: 30, debt: 4.0 }));
    for (const banned of ["you should", "buy", "sell", "avoid", "your "]) {
      expect(c.verdict.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("parseMetalsGrade", () => {
  const valid = {
    cost_margin_grade: 78,
    reported_aisc_usd: 1180,
    headline: "Lowest-quartile costs with a wide margin at current gold prices",
    summary: "Q1 AISC of $1,180/oz against gold near $2,600 leaves a ~$1,400 margin.",
    sources: [{ url: "https://example.com/q1", title: "Q1 results" }],
    confidence: "high",
  };

  it("accepts a valid grade and rounds", () => {
    const g = parseMetalsGrade(JSON.stringify({ ...valid, cost_margin_grade: 77.6 }));
    expect(g).not.toBeNull();
    expect(g!.costMarginGrade).toBe(78);
    expect(g!.reportedAiscUsd).toBe(1180);
  });

  it("nulls a non-positive AISC and rejects junk", () => {
    expect(
      parseMetalsGrade(JSON.stringify({ ...valid, reported_aisc_usd: -5 }))!
        .reportedAiscUsd,
    ).toBeNull();
    expect(parseMetalsGrade(JSON.stringify({ ...valid, cost_margin_grade: 130 }))).toBeNull();
    expect(parseMetalsGrade("prose, not json")).toBeNull();
  });
});

describe("metals research evidence renders through the shared news card", () => {
  it("parses with the desk's own grade label, never 'damage'", () => {
    const text =
      "[FNV · cost margin 85/100 · high] Streaming economics imply very low effective costs. · AISC ~$1,050/oz\n\n" +
      "The portfolio's fixed per-ounce payments equate to a wide margin at current prices.\n\n" +
      "Sources:\nQ1 report — https://example.com/fnv";
    const p = parseNewsEvidence(text);
    expect(p).not.toBeNull();
    expect(p!.gradeLabel).toBe("cost margin");
    expect(p!.grade).toBe(85);
    expect(p!.sources).toHaveLength(1);
  });
});

describe("research cache freshness", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  it("serves grades inside the 30-day window and expires older ones", () => {
    expect(isFresh("2026-07-01T00:00:00Z", now)).toBe(true);
    expect(isFresh("2026-06-01T00:00:00Z", now)).toBe(false);
  });
  it("rejects junk and future timestamps", () => {
    expect(isFresh("not a date", now)).toBe(false);
    expect(isFresh("2026-08-01T00:00:00Z", now)).toBe(false);
  });
});
