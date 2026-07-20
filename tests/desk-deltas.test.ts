import { describe, expect, it } from "vitest";
import { computeDeskDelta } from "@/lib/reports/desk-deltas";

const n = (securityId: string, classification: string | null) => ({
  securityId,
  classification,
});

describe("computeDeskDelta", () => {
  it("counts an improvement as an upgrade, a worsening as a downgrade", () => {
    const latest = [n("a", "well_positioned"), n("b", "vulnerable")];
    const previous = [n("a", "mixed"), n("b", "mixed")];
    // a: mixed(1) → well_positioned(0) = upgrade; b: mixed(1) → vulnerable(3) = downgrade
    expect(computeDeskDelta(latest, previous)).toEqual({ upgrades: 1, downgrades: 1 });
  });

  it("ignores names present in only one edition", () => {
    const latest = [n("a", "well_positioned"), n("new", "vulnerable")];
    const previous = [n("a", "well_positioned"), n("gone", "mixed")];
    expect(computeDeskDelta(latest, previous)).toEqual({ upgrades: 0, downgrades: 0 });
  });

  it("does not count moves to/from non-classifications", () => {
    const latest = [n("a", "insufficient_data"), n("b", "vulnerable")];
    const previous = [n("a", "mixed"), n("b", "insufficient_data")];
    expect(computeDeskDelta(latest, previous)).toEqual({ upgrades: 0, downgrades: 0 });
  });

  it("steady names are neither", () => {
    expect(
      computeDeskDelta([n("a", "resilient")], [n("a", "resilient")]),
    ).toEqual({ upgrades: 0, downgrades: 0 });
  });
});
