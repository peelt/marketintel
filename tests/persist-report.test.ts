import { describe, expect, it } from "vitest";
import { buildEvidenceRows } from "@/lib/agents/persist-report";
import type { RankedReport } from "@/lib/agents/types";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

function report(): RankedReport {
  return {
    agentName: "dividend",
    generatedAt: "2026-07-13T18:00:00.000Z",
    summaryMarkdown: "s",
    bodyMarkdown: "b",
    ranked: [
      {
        securityId: "sec-a",
        composite: 70,
        coverage: 1,
        breakdown: {},
        verdict: null,
        classification: null,
        evidenceRefs: [0, 1],
      },
      {
        securityId: "sec-b",
        composite: 60,
        coverage: 0.5,
        breakdown: {},
        verdict: "MILD_OVERSHOOT",
        classification: "watch",
        evidenceRefs: [2],
      },
    ],
    evidence: [
      {
        type: "financial_snapshot",
        sourceTable: "financials_snapshot",
        sourceId: UUID,
        text: "payout 45%",
        weight: 0.9,
      },
      {
        type: "derived_metric",
        sourceTable: "agent_runs",
        sourceId: "llm_grade", // not a UUID — must persist as null source_id
        text: "x".repeat(10_000), // must truncate to 8000
        weight: 1.7, // must clamp to 1
      },
      {
        type: "news_article",
        sourceTable: "news_articles",
        sourceId: UUID,
        text: "headline",
        weight: -0.2, // must clamp to 0
      },
    ],
  };
}

describe("buildEvidenceRows", () => {
  const items = [
    { id: "item-1", rank: 1 },
    { id: "item-2", rank: 2 },
  ];

  it("attaches evidence to the right item via rank ↔ evidenceRefs", () => {
    const rows = buildEvidenceRows(report(), items);
    expect(rows).toHaveLength(3);
    expect(rows[0].report_item_id).toBe("item-1");
    expect(rows[1].report_item_id).toBe("item-1");
    expect(rows[2].report_item_id).toBe("item-2");
    expect(rows[2].evidence_type).toBe("news_article");
  });

  it("nulls non-UUID source ids, truncates text to 8k, clamps weight to [0,1]", () => {
    const rows = buildEvidenceRows(report(), items);
    expect(rows[0].source_id).toBe(UUID);
    expect(rows[1].source_id).toBeNull();
    expect(rows[1].source_text.length).toBe(8_000);
    expect(rows[1].weight).toBe(1);
    expect(rows[2].weight).toBe(0);
  });

  it("skips candidates whose item row is missing and dangling refs", () => {
    const r = report();
    r.ranked[0].evidenceRefs = [0, 99]; // 99 dangles
    const rows = buildEvidenceRows(r, [{ id: "item-1", rank: 1 }]); // no rank-2 item
    expect(rows).toHaveLength(1);
    expect(rows[0].report_item_id).toBe("item-1");
  });
});
