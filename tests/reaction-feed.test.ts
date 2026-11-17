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

describe("dedupRecentDrops — on-demand runs count only for the names asked about", () => {
  // 17 Nov: the 00:41 edition flagged AAA and BBB. At 12:10 someone asked for
  // BBB; it qualified, so that run re-graded the whole cohort (AAA included).
  const times = new Map([
    ["edition", "2026-11-17T00:41:00Z"],
    ["on-demand", "2026-11-17T12:10:00Z"],
  ]);
  const rows = [
    item("a", "AAA", "strong_overshoot", "edition"),
    item("b", "BBB", "mild_overshoot", "edition"),
    item("a", "AAA", "proportionate", "on-demand"),
    item("b", "BBB", "strong_overshoot", "on-demand"),
  ];

  it("keeps the edition's verdict for names the on-demand run wasn't asked about", () => {
    const drops = dedupRecentDrops(rows, times, new Map([["on-demand", new Set(["BBB"])]]));
    const byTicker = Object.fromEntries(drops.map((d) => [d.ticker, d]));
    expect(byTicker.AAA.reportId).toBe("edition");
    expect(byTicker.AAA.classification).toBe("strong_overshoot");
    // The requested name takes the fresher, requested verdict — which is also
    // what the 24h "already screened" check needs to find.
    expect(byTicker.BBB.reportId).toBe("on-demand");
    expect(byTicker.BBB.classification).toBe("strong_overshoot");
  });

  it("matches the requested ticker case-insensitively", () => {
    const drops = dedupRecentDrops(rows, times, new Map([["on-demand", new Set(["BBB"])]]));
    expect(drops.find((d) => d.ticker === "BBB")?.reportId).toBe("on-demand");
    const lower = dedupRecentDrops(
      [item("c", "bt.a", "mild_overshoot", "on-demand")],
      times,
      new Map([["on-demand", new Set(["BT.A"])]]),
    );
    expect(lower).toHaveLength(1);
  });
});
