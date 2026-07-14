import { describe, expect, it } from "vitest";
import {
  annualDividendSeries,
  debtToEbitda,
  dividendGrowthCagr,
  fcfCover,
  median,
  payoutRatio,
  trailingYield,
  ttmDividendPerShare,
  yearsWithoutCut,
  yoyChange,
  zScore,
} from "@/lib/agents/dividend/metrics";
import { classifyDividend } from "@/lib/agents/dividend/agent";
import type { CandidateScore } from "@/lib/scoring/types";

const ASOF = "2026-07-14";

function quarterly(amount: number, years: number[]): { exDate: string; amount: number }[] {
  return years.flatMap((y) =>
    ["02-10", "05-10", "08-10", "11-10"].map((md) => ({
      exDate: `${y}-${md}`,
      amount,
    })),
  );
}

describe("ttmDividendPerShare", () => {
  it("sums payments with ex-dates inside the trailing 365 days", () => {
    const payments = [
      { exDate: "2025-08-10", amount: 0.25 },
      { exDate: "2025-11-10", amount: 0.25 },
      { exDate: "2026-02-10", amount: 0.26 },
      { exDate: "2026-05-10", amount: 0.26 },
      { exDate: "2025-05-10", amount: 0.25 }, // outside window
    ];
    expect(ttmDividendPerShare(payments, ASOF)).toBeCloseTo(1.02);
  });

  it("returns null (not 0) with no payments in window — missing ≠ zero", () => {
    expect(ttmDividendPerShare([], ASOF)).toBeNull();
    expect(
      ttmDividendPerShare([{ exDate: "2020-01-01", amount: 1 }], ASOF),
    ).toBeNull();
  });
});

describe("trailingYield", () => {
  it("divides like-by-like", () => {
    expect(trailingYield(1.02, 20.4)).toBeCloseTo(0.05);
  });
  it("nulls on missing or non-positive price", () => {
    expect(trailingYield(1, null)).toBeNull();
    expect(trailingYield(null, 100)).toBeNull();
    expect(trailingYield(1, 0)).toBeNull();
  });
});

describe("annualDividendSeries", () => {
  it("excludes the current partial year so it can't read as a phantom cut", () => {
    const series = annualDividendSeries(
      quarterly(0.25, [2023, 2024, 2025]).concat([
        { exDate: "2026-02-10", amount: 0.25 }, // partial 2026
      ]),
      ASOF,
    );
    expect(series.map((s) => s.year)).toEqual([2023, 2024, 2025]);
    expect(series[0].total).toBeCloseTo(1.0);
  });

  it("fills observed gap years with 0 — a genuine skipped year is a cut", () => {
    const series = annualDividendSeries(
      [
        { exDate: "2022-05-01", amount: 1 },
        { exDate: "2024-05-01", amount: 1 },
      ],
      ASOF,
    );
    expect(series).toEqual([
      { year: 2022, total: 1 },
      { year: 2023, total: 0 },
      { year: 2024, total: 1 },
      { year: 2025, total: 0 },
    ]);
  });
});

describe("dividendGrowthCagr", () => {
  it("computes CAGR over the window", () => {
    const series = [
      { year: 2021, total: 1.0 },
      { year: 2022, total: 1.1 },
      { year: 2023, total: 1.21 },
    ];
    expect(dividendGrowthCagr(series, 5)).toBeCloseTo(0.1, 5);
  });
  it("nulls with fewer than two complete years or zero start", () => {
    expect(dividendGrowthCagr([{ year: 2025, total: 1 }])).toBeNull();
    expect(
      dividendGrowthCagr([
        { year: 2024, total: 0 },
        { year: 2025, total: 1 },
      ]),
    ).toBeNull();
  });
});

describe("yearsWithoutCut", () => {
  it("counts back from the most recent year and stops at a cut", () => {
    const series = [
      { year: 2021, total: 1.0 },
      { year: 2022, total: 0.5 }, // cut
      { year: 2023, total: 0.55 },
      { year: 2024, total: 0.6 },
      { year: 2025, total: 0.6 },
    ];
    expect(yearsWithoutCut(series)).toBe(3);
  });

  it("tolerates small FX/rounding declines below the threshold", () => {
    const series = [
      { year: 2024, total: 1.0 },
      { year: 2025, total: 0.99 }, // -1% — noise, not a cut
    ];
    expect(yearsWithoutCut(series)).toBe(1);
  });
});

describe("zScore", () => {
  it("scores the latest value against its own history", () => {
    const flat = Array(23).fill(0.04);
    expect(zScore([...flat, 0.08])).toBeGreaterThan(3);
    // Alternating 2/4 has mean 3 exactly (integers — no FP noise); a final 3
    // sits dead on the mean.
    expect(zScore([2, 4, 2, 4, 2, 4, 2, 4, 3])).toBe(0);
  });
  it("nulls below the 8-point floor", () => {
    expect(zScore([0.04, 0.05, 0.04])).toBeNull();
  });
});

describe("financial ratios", () => {
  it("payoutRatio normalises negative (cash-outflow) dividendsPaid", () => {
    expect(payoutRatio(-600, 1000)).toBeCloseTo(0.6);
  });
  it("payoutRatio nulls on non-positive earnings — a loss-maker's ratio is undefined, not 'great'", () => {
    expect(payoutRatio(-600, -50)).toBeNull();
    expect(payoutRatio(-600, 0)).toBeNull();
  });
  it("fcfCover and debtToEbitda behave and null correctly", () => {
    expect(fcfCover(1200, -600)).toBeCloseTo(2.0);
    expect(fcfCover(1200, 0)).toBeNull();
    expect(debtToEbitda(3000, 1000)).toBeCloseTo(3.0);
    expect(debtToEbitda(3000, -100)).toBeNull();
  });
  it("yoyChange handles signs and nulls on zero prior", () => {
    expect(yoyChange(110, 100)).toBeCloseTo(0.1);
    expect(yoyChange(90, 100)).toBeCloseTo(-0.1);
    expect(yoyChange(100, 0)).toBeNull();
  });
  it("median handles odd, even, empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("classifyDividend", () => {
  function scored(overrides: {
    coverage: number;
    cutRisk?: number | null;
    fcfCoverRaw?: number | null;
  }): CandidateScore {
    return {
      securityId: "s1",
      composite: 50,
      coverage: overrides.coverage,
      criteria: {
        coverage_and_sustainability: {
          score: 50,
          signals: {
            fcf_dividend_cover_ttm: {
              raw: overrides.fcfCoverRaw ?? null,
              normalised: 50,
              weight: 0.4,
            },
          },
        },
        cut_risk_signals: {
          score: overrides.cutRisk === undefined ? 70 : overrides.cutRisk,
          signals: {},
        },
      },
      evidence: [],
    };
  }

  it("withholds classification below the coverage floor — never guesses", () => {
    const c = classifyDividend(scored({ coverage: 0.2 }));
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("withheld");
  });

  it("bands cut risk: elevated below 35, watch below 55, resilient above", () => {
    expect(classifyDividend(scored({ coverage: 0.8, cutRisk: 20 })).classification).toBe("elevated_cut_risk");
    expect(classifyDividend(scored({ coverage: 0.8, cutRisk: 45 })).classification).toBe("watch");
    expect(classifyDividend(scored({ coverage: 0.8, cutRisk: 70 })).classification).toBe("resilient");
  });

  it("treats a null cut-risk score as unclassifiable risk, not elevated risk", () => {
    const c = classifyDividend(scored({ coverage: 0.8, cutRisk: null }));
    expect(c.classification).toBe("resilient");
  });

  it("surfaces factual drivers in the verdict without advice language", () => {
    const c = classifyDividend(
      scored({ coverage: 0.8, cutRisk: 20, fcfCoverRaw: 0.7 }),
    );
    expect(c.verdict).toContain("free cash flow covers only 0.70×");
    expect(c.verdict.toLowerCase()).not.toContain("you should");
    expect(c.verdict.toLowerCase()).not.toContain("sell");
    expect(c.verdict.toLowerCase()).not.toContain("buy");
  });
});
