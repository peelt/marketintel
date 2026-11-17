import { describe, expect, it } from "vitest";
import { splitDeskReports, type DeskReportRow } from "@/lib/reports/desk-reports";

function row(
  id: string,
  generated_at: string,
  over: Partial<DeskReportRow> = {},
): DeskReportRow {
  return {
    id,
    agent_name: "reaction",
    generated_at,
    summary_markdown: "853 names screened; 8 cleared the drop threshold.",
    trigger: "scheduled",
    requestedTickers: null,
    ...over,
  };
}

const onDemand = (tickers: string[]) => ({ trigger: "event", requestedTickers: tickers });

describe("splitDeskReports — the dashboard's latest edition is a DAILY edition", () => {
  it("an on-demand run filed after the morning edition doesn't become the latest", () => {
    const { editions, onDemand: od } = splitDeskReports([
      row("bats", "2026-11-17T12:10:00Z", onDemand(["BATS"])),
      row("today", "2026-11-17T00:41:00Z"),
      row("sat", "2026-11-14T00:40:00Z"),
    ]);
    expect(editions.map((e) => e.id)).toEqual(["today", "sat"]);
    expect(od.map((r) => [r.id, r.requestedTickers])).toEqual([["bats", ["BATS"]]]);
  });

  it("so the desk card's delta compares two editions, not an edition and a stub", () => {
    const { editions } = splitDeskReports([
      row("vod", "2026-11-17T15:00:00Z", onDemand(["VOD"])),
      row("bats", "2026-11-17T12:10:00Z", onDemand(["BATS"])),
      row("today", "2026-11-17T00:41:00Z"),
      row("sat", "2026-11-14T00:40:00Z"),
    ]);
    expect(editions.slice(0, 2).map((e) => e.id)).toEqual(["today", "sat"]);
  });

  it("24 Jul: a manual run is set aside for the day's scheduled edition", () => {
    const { editions, onDemand: od } = splitDeskReports([
      row("sched", "2026-07-24T21:39:00Z"),
      row("manual", "2026-07-24T08:37:00Z", { trigger: "manual" }),
    ]);
    expect(editions.map((e) => e.id)).toEqual(["sched"]);
    expect(od).toEqual([]);
  });

  it("22 Sep: of two scheduled runs one date keeps one edition", () => {
    const { editions } = splitDeskReports([
      row("late", "2026-09-22T01:02:00Z"),
      row("early", "2026-09-22T00:41:00Z"),
      row("prev", "2026-09-19T00:40:00Z"),
    ]);
    expect(editions.map((e) => e.id)).toEqual(["late", "prev"]);
  });

  it("only on-demand runs on file: no edition, and nothing pretends to be one", () => {
    const { editions, onDemand: od } = splitDeskReports([
      row("bats", "2026-10-09T12:10:00Z", onDemand(["BATS"])),
    ]);
    expect(editions).toEqual([]);
    expect(od).toHaveLength(1);
    expect(splitDeskReports([])).toEqual({ editions: [], onDemand: [] });
  });
});
