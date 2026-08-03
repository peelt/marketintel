import { describe, expect, it } from "vitest";
import {
  claimedDirection,
  forwardReturn,
  latestSessionOnOrBefore,
  medianOf,
  summariseBands,
  type OutcomeRow,
} from "@/lib/scorecard/calc";
import type { SessionRow } from "@/lib/agents/reaction/metrics";

function series(closes: number[], startDay = 1): SessionRow[] {
  return closes.map((close, i) => ({
    date: `2026-07-${String(startDay + i).padStart(2, "0")}`,
    close,
  }));
}

describe("forwardReturn", () => {
  const s = series([100, 110, 90, 120, 130, 140]); // 07-01 .. 07-06

  it("measures over trading sessions from the given t0", () => {
    expect(forwardReturn(s, "2026-07-01", 1)).toBeCloseTo(0.1);
    expect(forwardReturn(s, "2026-07-01", 5)).toBeCloseTo(0.4);
    expect(forwardReturn(s, "2026-07-03", 2)).toBeCloseTo(130 / 90 - 1);
  });

  it("returns null while the window hasn't matured — pending, never zero", () => {
    expect(forwardReturn(s, "2026-07-05", 5)).toBeNull();
    expect(forwardReturn(s, "2026-07-06", 1)).toBeNull();
  });

  it("returns null when t0 isn't a session in the series", () => {
    expect(forwardReturn(s, "2026-06-30", 1)).toBeNull();
  });
});

describe("latestSessionOnOrBefore", () => {
  const s = series([100, 100], 1); // 07-01, 07-02

  it("anchors a report date to the security's own last print", () => {
    expect(latestSessionOnOrBefore(s, "2026-07-02")).toBe("2026-07-02");
    // Holiday on the report date → the prior session anchors it.
    expect(latestSessionOnOrBefore(s, "2026-07-04")).toBe("2026-07-02");
    expect(latestSessionOnOrBefore(s, "2026-06-30")).toBeNull();
  });
});

describe("summariseBands", () => {
  const row = (
    classification: string,
    securityId: string,
    r5: number | null,
    u5: number | null,
  ): OutcomeRow => ({
    classification,
    securityId,
    r: { 1: null, 5: r5, 20: null },
    universe: { 1: null, 5: u5, 20: null },
  });

  it("measures excess over the universe, not raw returns", () => {
    // +5% raw in a +8% market is a MISS for an overshoot claim.
    const bands = summariseBands([
      row("strong_overshoot", "a", 0.05, 0.08),
      row("strong_overshoot", "b", 0.1, 0.02),
    ]);
    const strong = bands.find((b) => b.classification === "strong_overshoot")!;
    expect(strong.medianExcess[5]).toBeCloseTo((-0.03 + 0.08) / 2);
    expect(strong.hitRate[5]).toBeCloseTo(0.5);
  });

  it("underreaction hits on NEGATIVE excess; proportionate has no hit rate", () => {
    const bands = summariseBands([
      row("underreaction", "c", -0.06, 0.01),
      row("proportionate", "d", 0.0, 0.0),
    ]);
    expect(bands.find((b) => b.classification === "underreaction")!.hitRate[5]).toBe(1);
    expect(bands.find((b) => b.classification === "proportionate")!.hitRate[5]).toBeNull();
  });

  it("counts repeat flags as observations but reports unique names", () => {
    const bands = summariseBands([
      row("mild_overshoot", "sndk", 0.02, 0.0),
      row("mild_overshoot", "sndk", 0.03, 0.0),
      row("mild_overshoot", "glw", null, null), // pending
    ]);
    const mild = bands.find((b) => b.classification === "mild_overshoot")!;
    expect(mild.observations).toBe(3);
    expect(mild.uniqueNames).toBe(2);
    expect(mild.pending[5]).toBe(1);
  });

  it("empty bands render as no-data, never zero", () => {
    const strong = summariseBands([]).find(
      (b) => b.classification === "strong_overshoot",
    )!;
    expect(strong.observations).toBe(0);
    expect(strong.medianExcess[5]).toBeNull();
    expect(strong.hitRate[5]).toBeNull();
  });

  it("claimedDirection encodes each band's own claim", () => {
    expect(claimedDirection("strong_overshoot")).toBe(1);
    expect(claimedDirection("mild_overshoot")).toBe(1);
    expect(claimedDirection("underreaction")).toBe(-1);
    expect(claimedDirection("proportionate")).toBeNull();
    expect(claimedDirection("corporate_action")).toBeNull();
  });

  it("medianOf handles evens and empties", () => {
    expect(medianOf([1, 3])).toBe(2);
    expect(medianOf([])).toBeNull();
  });
});
