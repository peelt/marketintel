import { describe, expect, it } from "vitest";
import { rankDeskVerdicts } from "@/lib/security/dossier";

/**
 * rankDeskVerdicts reduces a security's report_items (across desks + editions)
 * to one latest verdict per desk, with the delta vs that desk's previous
 * edition, ordered most-concerning first. Pure — no I/O.
 */

const row = (
  agent: string,
  generatedAt: string,
  classification: string | null,
  composite: number,
  verdict: string | null = null,
) => ({
  classification,
  composite_score: composite,
  scoring_breakdown: { coverage: 1 },
  verdict,
  report: {
    id: `${agent}-${generatedAt}`,
    agent_name: agent,
    generated_at: generatedAt,
    agent_runs: { status: "succeeded" },
  },
});

const color = () => "#000";
const display = (a: string) => a.toUpperCase();

describe("rankDeskVerdicts", () => {
  it("keeps the latest edition per desk and diffs vs the previous", () => {
    const desks = rankDeskVerdicts(
      [
        row("metals", "2026-07-01T00:00:00Z", "well_positioned", 80),
        row("metals", "2026-07-15T00:00:00Z", "vulnerable", 40, "AISC crept above spot"),
      ],
      color,
      display,
    );
    expect(desks).toHaveLength(1);
    expect(desks[0].classification).toBe("vulnerable");
    expect(desks[0].verdict).toBe("AISC crept above spot");
    expect(desks[0].reportId).toBe("metals-2026-07-15T00:00:00Z");
    // well_positioned → vulnerable is a worsening, and a fresh flag → attention.
    expect(desks[0].delta.direction).toBe("worsened");
    expect(desks[0].delta.attention).toBe(true);
  });

  it("orders desks most-concerning first", () => {
    const desks = rankDeskVerdicts(
      [
        row("dividend", "2026-07-10T00:00:00Z", "resilient", 70),
        row("geopolitical", "2026-07-12T00:00:00Z", "at_risk", 55),
        row("metals", "2026-07-11T00:00:00Z", "mixed", 60),
      ],
      color,
      display,
    );
    expect(desks.map((d) => d.agentName)).toEqual([
      "geopolitical", // at_risk (rank 3)
      "metals", // mixed (rank 1)
      "dividend", // resilient (rank 0)
    ]);
    expect(desks[0].agentDisplay).toBe("GEOPOLITICAL");
  });

  it("returns nothing for a name no desk has covered", () => {
    expect(rankDeskVerdicts([], color, display)).toEqual([]);
  });
});
