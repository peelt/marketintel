import { describe, expect, it } from "vitest";
import {
  computeDelta,
  describeDelta,
  sortDeltasForFeed,
  summarizeHealth,
  type VerdictSnapshot,
} from "@/lib/holdings/deltas";

function snap(
  classification: string | null,
  overrides: Partial<VerdictSnapshot> = {},
): VerdictSnapshot {
  return {
    agentName: "dividend",
    classification,
    composite: 50,
    coverage: 0.8,
    runAt: "2026-07-15T18:00:00Z",
    reportId: "r1",
    ...overrides,
  };
}

describe("computeDelta", () => {
  it("flags a NEW concerning classification as attention", () => {
    const d = computeDelta(snap("elevated_cut_risk"), null);
    expect(d.direction).toBe("new");
    expect(d.attention).toBe(true);
  });

  it("does not raise attention for a new benign classification", () => {
    const d = computeDelta(snap("resilient"), null);
    expect(d.direction).toBe("new");
    expect(d.attention).toBe(false);
  });

  it("WORSENING into a flag is the headline event (resilient → elevated cut risk)", () => {
    const d = computeDelta(snap("elevated_cut_risk"), snap("resilient"));
    expect(d.direction).toBe("worsened");
    expect(d.attention).toBe(true);
  });

  it("improvement is shown but never urgent", () => {
    const d = computeDelta(snap("resilient"), snap("elevated_cut_risk"));
    expect(d.direction).toBe("improved");
    expect(d.attention).toBe(false);
  });

  it("a name leaving the screen resolves without attention", () => {
    const d = computeDelta(null, snap("mild_overshoot", { agentName: "reaction" }));
    expect(d.direction).toBe("resolved");
    expect(d.attention).toBe(false);
  });

  it("a held name newly appearing in a Reaction report is attention (it dropped hard)", () => {
    const d = computeDelta(
      snap("mild_overshoot", { agentName: "reaction" }),
      null,
    );
    expect(d.direction).toBe("new");
    expect(d.attention).toBe(true);
  });

  it("a held name that dropped with UNKNOWN cause is still attention", () => {
    const d = computeDelta(
      snap("cause_unconfirmed", { agentName: "reaction" }),
      null,
    );
    expect(d.direction).toBe("new");
    expect(d.attention).toBe(true);
  });

  it("same classification is steady", () => {
    const d = computeDelta(snap("watch"), snap("watch"));
    expect(d.direction).toBe("steady");
    expect(d.attention).toBe(false);
  });
});

describe("describeDelta", () => {
  it("is factual and security-scoped, never advice", () => {
    const s = describeDelta(
      computeDelta(snap("elevated_cut_risk"), snap("resilient")),
      "PFE",
      "Dividend Intelligence",
    );
    expect(s).toBe(
      "Dividend Intelligence moved PFE from resilient to elevated cut risk.",
    );
    expect(s.toLowerCase()).not.toContain("you");
    expect(s.toLowerCase()).not.toContain("sell");
  });
});

describe("sortDeltasForFeed", () => {
  it("puts attention items first, then by concern rank", () => {
    const items = [
      { id: "steady", delta: computeDelta(snap("resilient"), snap("resilient")) },
      { id: "attn-watch", delta: computeDelta(snap("watch"), snap("resilient")) },
      {
        id: "attn-elevated",
        delta: computeDelta(snap("elevated_cut_risk"), snap("resilient")),
      },
    ];
    expect(sortDeltasForFeed(items).map((i) => i.id)).toEqual([
      "attn-elevated",
      "attn-watch",
      "steady",
    ]);
  });
});

describe("summarizeHealth", () => {
  it("counts covered and flagged names, ordered by concern", () => {
    const h = summarizeHealth([
      { classification: "resilient" },
      { classification: "elevated_cut_risk" },
      { classification: "watch" },
      { classification: null }, // uncovered — skipped
    ]);
    expect(h.covered).toBe(3);
    expect(h.flagged).toBe(2);
    expect(h.byClassification[0].classification).toBe("elevated_cut_risk");
  });
});
