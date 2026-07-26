import { describe, expect, it } from "vitest";
import {
  summariseReactionCoverage,
  type CoverageItemRow,
} from "@/lib/reports/reaction-coverage";

function item(
  exchange: string,
  coverage: number,
  signals: { news?: number | null; lev?: number | null; cash?: number | null },
): CoverageItemRow {
  return {
    report_id: "r1",
    classification: "mild_overshoot",
    scoring_breakdown: {
      coverage,
      criteria: {
        earned_damage: {
          score: 50,
          signals: {
            news_damage_severity: signals.news ?? null,
            leverage_fragility: signals.lev ?? null,
            cash_generation: signals.cash ?? null,
          },
        },
      },
    },
    security: { ticker: "X", exchange },
  };
}

describe("summariseReactionCoverage", () => {
  it("splits by exchange and averages coverage per market", () => {
    const [us, lse] = summariseReactionCoverage([
      item("US", 1.0, { news: 40, lev: 60, cash: 55 }),
      item("US", 0.9, { news: 30, lev: 50, cash: null }),
      item("LSE", 0.8, { news: 70 }), // no fundamentals — the predicted gap
    ]);
    expect(us).toMatchObject({ market: "US", n: 2, withNews: 2, withFundamentals: 2 });
    expect(us.avgCoverage).toBeCloseTo(0.95);
    expect(lse).toMatchObject({ market: "LSE", n: 1, withNews: 1, withFundamentals: 0 });
    expect(lse.avgCoverage).toBeCloseTo(0.8);
  });

  it("one non-null fundamentals signal counts as having fundamentals", () => {
    const [, lse] = summariseReactionCoverage([
      item("LSE", 0.9, { news: 20, cash: 45 }),
    ]);
    expect(lse.withFundamentals).toBe(1);
  });

  it("handles empty input and missing breakdowns without inventing numbers", () => {
    const [us, lse] = summariseReactionCoverage([]);
    expect(us).toMatchObject({ n: 0, avgCoverage: null });
    expect(lse).toMatchObject({ n: 0, avgCoverage: null });

    const [us2] = summariseReactionCoverage([
      { report_id: "r", classification: null, scoring_breakdown: null, security: { ticker: "Y", exchange: "US" } },
    ]);
    expect(us2.n).toBe(1);
    expect(us2.avgCoverage).toBeNull(); // no coverage value ≠ zero coverage
    expect(us2.withNews).toBe(0);
  });

  it("buckets unknown exchanges as US rather than dropping them", () => {
    const [us, lse] = summariseReactionCoverage([
      item("XETRA", 0.7, { news: 10 }),
    ]);
    expect(us.n).toBe(1);
    expect(lse.n).toBe(0);
  });
});
