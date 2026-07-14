import { describe, expect, it } from "vitest";
import { normaliseValues } from "@/lib/scoring/normalise";

describe("rank normalisation (default)", () => {
  it("maps worst→0, best→100, preserving order", () => {
    expect(normaliseValues([1, 3, 2], "higher_better")).toEqual([0, 100, 50]);
  });

  it("inverts for lower_better", () => {
    expect(normaliseValues([1, 3, 2], "lower_better")).toEqual([100, 0, 50]);
  });

  it("keeps nulls null and ranks the rest", () => {
    expect(normaliseValues([5, null, 10], "higher_better")).toEqual([
      0,
      null,
      100,
    ]);
  });

  it("single present value scores 100", () => {
    expect(normaliseValues([null, 7], "higher_better")).toEqual([null, 100]);
  });

  it("all-null input stays all-null", () => {
    expect(normaliseValues([null, null], "higher_better")).toEqual([
      null,
      null,
    ]);
  });
});

describe("zscore normalisation", () => {
  it("is reachable via the method parameter and maps mean to 50", () => {
    const out = normaliseValues([10, 20, 30], "higher_better", "zscore");
    expect(out[1]).toBeCloseTo(50);
    expect(out[0]!).toBeLessThan(50);
    expect(out[2]!).toBeGreaterThan(50);
  });

  it("zero variance maps every present value to 50", () => {
    expect(normaliseValues([5, 5, null], "higher_better", "zscore")).toEqual([
      50, 50, null,
    ]);
  });

  it("clamps beyond ±3 sd", () => {
    const out = normaliseValues(
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1000],
      "higher_better",
      "zscore",
    );
    expect(out[9]).toBeLessThanOrEqual(100);
    expect(out[0]).toBeGreaterThanOrEqual(0);
  });
});

describe("absolute normalisation (passthrough)", () => {
  it("passes calibrated 0–100 values straight through — no re-ranking", () => {
    // Three weak candidates must all stay weak, not spread 0→100.
    expect(normaliseValues([20, 25, 30], "higher_better", "absolute")).toEqual([
      20, 25, 30,
    ]);
  });

  it("clamps out-of-range values", () => {
    expect(
      normaliseValues([-10, 150, 60], "higher_better", "absolute"),
    ).toEqual([0, 100, 60]);
  });

  it("inverts for lower_better", () => {
    expect(normaliseValues([30, null], "lower_better", "absolute")).toEqual([
      70,
      null,
    ]);
  });
});
