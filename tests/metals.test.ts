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

function scored(
  composite: number,
  coverage = 0.8,
  costGrade: number | null = 70,
): CandidateScore {
  return {
    securityId: "s1",
    composite,
    coverage,
    criteria: {
      cost_position: {
        score: 70,
        signals: {
          aisc_margin_grade: { raw: costGrade, normalised: costGrade, weight: 1 },
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

describe("classifyMetals", () => {
  it("bands the composite into position verdicts", () => {
    expect(classifyMetals(scored(75)).classification).toBe("well_positioned");
    expect(classifyMetals(scored(55)).classification).toBe("mixed");
    expect(classifyMetals(scored(30)).classification).toBe("vulnerable");
  });

  it("withholds classification below the coverage floor", () => {
    const c = classifyMetals(scored(75, 0.2));
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("withheld");
  });

  it("verdict names the cost grade when present, and the gap when absent", () => {
    expect(classifyMetals(scored(75)).verdict).toContain("70/100");
    expect(classifyMetals(scored(75, 0.8, null)).verdict).toContain(
      "No current cost disclosure",
    );
  });

  it("verdict text is factual and impersonal (I2)", () => {
    const c = classifyMetals(scored(30));
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
