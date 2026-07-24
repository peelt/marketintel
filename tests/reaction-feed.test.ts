import { describe, expect, it } from "vitest";
import { dedupRecentDrops } from "@/lib/reports/reaction-feed";

const item = (
  securityId: string,
  ticker: string,
  classification: string | null,
  reportId: string,
) => ({
  security_id: securityId,
  classification,
  composite_score: 70,
  scoring_breakdown: { coverage: 1 },
  report_id: reportId,
  security: { ticker, name: `${ticker} Inc` },
});

describe("dedupRecentDrops", () => {
  const times = new Map([
    ["r-old", "2026-07-20T22:00:00Z"],
    ["r-new", "2026-07-21T22:00:00Z"],
  ]);

  it("keeps the freshest run per security", () => {
    const drops = dedupRecentDrops(
      [
        item("a", "AAA", "mild_overshoot", "r-old"),
        item("a", "AAA", "strong_overshoot", "r-new"),
      ],
      times,
    );
    expect(drops).toHaveLength(1);
    expect(drops[0].classification).toBe("strong_overshoot");
    expect(drops[0].screenedAt).toBe("2026-07-21T22:00:00Z");
  });

  it("orders most-concerning first, then most-recent", () => {
    const drops = dedupRecentDrops(
      [
        item("a", "AAA", "mild_overshoot", "r-new"),
        item("b", "BBB", "strong_overshoot", "r-old"),
      ],
      times,
    );
    expect(drops.map((d) => d.ticker)).toEqual(["BBB", "AAA"]); // strong outranks mild
  });

  it("drops rows with no classification or an unknown report", () => {
    const drops = dedupRecentDrops(
      [
        item("a", "AAA", null, "r-new"),
        item("b", "BBB", "mild_overshoot", "r-missing"),
      ],
      times,
    );
    expect(drops).toEqual([]);
  });
});
