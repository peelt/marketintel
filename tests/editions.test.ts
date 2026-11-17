import { describe, expect, it } from "vitest";
import {
  buildEditionIndex,
  buildEditionIndexes,
  calendarWeeks,
  deskOfReport,
  editionFindings,
  latestEdition,
  locateEdition,
  monthKey,
  onDemandTickers,
  overshootLevel,
  parseEditionSummary,
  shiftMonth,
  type EditionRowInput,
} from "@/lib/reports/editions";
import { formatEditionDate, formatMonthLabel } from "@/lib/format";

const FULL = { reason: null, tickers: null };

function row(
  id: string,
  generated_at: string,
  over: Partial<EditionRowInput> = {},
): EditionRowInput {
  return {
    id,
    agent_name: "reaction",
    generated_at,
    summary_markdown:
      "853 names screened; 8 cleared the drop threshold. Framework flags 3 moves as overshoot: **AXON**, **KNOS**, **GPN**.",
    trigger: "scheduled",
    input_params: FULL,
    ...over,
  };
}

describe("parseEditionSummary — every shape ever filed", () => {
  it("the standard edition", () => {
    expect(
      parseEditionSummary(
        "853 names screened; 12 cleared the drop threshold. Framework flags 4 moves as overshoot: **MRNA**, **FSLR**, **SNDK**. 1 screened fall was a corporate action rather than a loss of value, so no overshoot verdict was filed: **LITE**. 9 of 11 graded drops trace to the macro backdrop.",
      ),
    ).toEqual({ cleared: 12, overshoots: 4, flagged: ["MRNA", "FSLR", "SNDK"] });
  });

  it("the old printf plural and a singular", () => {
    expect(
      parseEditionSummary(
        "853 names screened; 4 cleared the drop threshold. Framework flags 2 move(s) as overshoot: **MRNA**, **ISRG**.",
      ),
    ).toEqual({ cleared: 4, overshoots: 2, flagged: ["MRNA", "ISRG"] });
    expect(
      parseEditionSummary(
        "853 names screened; 3 cleared the drop threshold. Framework flags 1 move as overshoot: **COHR**.",
      ),
    ).toEqual({ cleared: 3, overshoots: 1, flagged: ["COHR"] });
  });

  it("a capped cohort — cleared is the number that cleared, not the number analysed", () => {
    expect(
      parseEditionSummary(
        "853 names screened; 52 cleared the drop threshold (top 20 by severity analysed, 32 deferred). Framework flags 12 moves as overshoot: **A**, **B**, **C**.",
      ),
    ).toEqual({ cleared: 52, overshoots: 12, flagged: ["A", "B", "C"] });
  });

  it("a ticker with a dot is not cut at the dot", () => {
    expect(
      parseEditionSummary(
        "853 names screened; 5 cleared the drop threshold. Framework flags 2 moves as overshoot: **BT.A**, **RDS.B**. 2 drops unranked — no news grade this run: **XYZ**.",
      ).flagged,
    ).toEqual(["BT.A", "RDS.B"]);
  });

  it("no overshoot is a real zero", () => {
    expect(
      parseEditionSummary(
        "853 names screened; 3 cleared the drop threshold. No screened move graded as overshoot — declines look earned or worse.",
      ),
    ).toEqual({ cleared: 3, overshoots: 0, flagged: [] });
  });

  it("the base agent's empty stub is a real zero, not unknown", () => {
    expect(
      parseEditionSummary("_No candidates passed the Reaction Analyser screen this run._"),
    ).toEqual({ cleared: 0, overshoots: 0, flagged: [] });
  });

  it("an on-demand stub states no counts — null, never a guessed 0", () => {
    expect(
      parseEditionSummary(
        "**BATS** was requested on demand: 4.4% over 5 sessions / 1.9% on the day at the latest close does not clear the drop screen (a fall of 12%+ over 5 sessions or 8%+ in one) — the desk only grades qualifying drops, so no overshoot verdict is filed.",
      ),
    ).toEqual({ cleared: null, overshoots: null, flagged: [] });
  });

  it("an on-demand prefix ahead of a full cohort still parses the cohort", () => {
    expect(
      parseEditionSummary(
        "**VOD** was requested on demand: it cleared the screen. 853 names screened; 6 cleared the drop threshold. Framework flags 2 moves as overshoot: **VOD**, **AXON**.",
      ),
    ).toEqual({ cleared: 6, overshoots: 2, flagged: ["VOD", "AXON"] });
  });

  it("anything unrecognised is unknown", () => {
    expect(parseEditionSummary("Something else entirely.")).toEqual({
      cleared: null,
      overshoots: null,
      flagged: [],
    });
  });
});

describe("onDemandTickers — the three live input_params shapes", () => {
  it("reads the requested tickers", () => {
    expect(
      onDemandTickers({ reason: "on-demand: BATS requested from the dashboard", tickers: ["BATS"] }),
    ).toEqual(["BATS"]);
  });
  it("a full-universe run has none", () => {
    expect(onDemandTickers({ reason: null, tickers: null })).toBeNull();
    expect(onDemandTickers({ reason: "manual ops trigger" })).toBeNull();
    expect(onDemandTickers({ tickers: [] })).toBeNull();
    expect(onDemandTickers(null)).toBeNull();
    expect(onDemandTickers("tickers")).toBeNull();
  });
});

describe("buildEditionIndex — one daily edition per date", () => {
  it("orders oldest → newest and keys on the UTC day", () => {
    const idx = buildEditionIndex([
      row("b", "2026-11-17T00:41:38.532+00:00"),
      row("a", "2026-11-14T00:40:41.603+00:00"),
      // 01:30 in +02:00 is 23:30 the previous UTC day.
      row("c", "2026-11-13T01:30:00+02:00"),
    ]);
    expect(idx.editions.map((e) => [e.id, e.date])).toEqual([
      ["c", "2026-11-12"],
      ["a", "2026-11-14"],
      ["b", "2026-11-17"],
    ]);
    expect(idx.extras).toEqual([]);
  });

  it("24 Jul: the scheduled run is the edition, though a manual run exists", () => {
    const idx = buildEditionIndex([
      row("manual", "2026-07-24T08:37:00Z", { trigger: "manual", input_params: { reason: "manual ops trigger" } }),
      row("sched", "2026-07-24T21:39:00Z"),
    ]);
    expect(idx.editions.map((e) => e.id)).toEqual(["sched"]);
    expect(idx.extras).toEqual([
      { id: "manual", date: "2026-07-24", time: "08:37", kind: "superseded", tickers: [] },
    ]);
  });

  it("scheduled wins even when a manual run is LATER that day", () => {
    const idx = buildEditionIndex([
      row("sched", "2026-11-17T00:41:00Z"),
      row("manual", "2026-11-17T15:00:00Z", { trigger: "manual" }),
    ]);
    expect(idx.editions.map((e) => e.id)).toEqual(["sched"]);
  });

  it("22 Sep: of two scheduled runs the later one stands", () => {
    const idx = buildEditionIndex([
      row("early", "2026-09-22T00:40:00Z"),
      row("late", "2026-09-22T21:44:00Z"),
    ]);
    expect(idx.editions.map((e) => e.id)).toEqual(["late"]);
    expect(idx.extras.map((e) => [e.id, e.kind])).toEqual([["early", "superseded"]]);
  });

  it("9 Oct: on-demand runs never become the day's edition", () => {
    const onDemand = {
      trigger: "event",
      input_params: { reason: "on-demand: BATS requested from the dashboard", tickers: ["BATS"] },
      summary_markdown: "**BATS** was requested on demand: does not clear the drop screen.",
    };
    const idx = buildEditionIndex([
      row("bats2", "2026-10-09T12:05:00Z", onDemand),
      row("bats1", "2026-10-09T12:03:00Z", onDemand),
      row("sched", "2026-10-09T00:41:00Z"),
    ]);
    expect(idx.editions.map((e) => e.id)).toEqual(["sched"]);
    expect(idx.extras).toEqual([
      { id: "bats2", date: "2026-10-09", time: "12:05", kind: "on_demand", tickers: ["BATS"] },
      { id: "bats1", date: "2026-10-09", time: "12:03", kind: "on_demand", tickers: ["BATS"] },
    ]);
  });

  it("a date with only an on-demand run has no edition", () => {
    const idx = buildEditionIndex([
      row("vod", "2026-09-05T10:00:00Z", { trigger: "event", input_params: { tickers: ["VOD"] } }),
    ]);
    expect(idx.editions).toEqual([]);
    expect(latestEdition(idx)).toBeNull();
  });

  it("the latest edition is never the on-demand row filed after it", () => {
    const idx = buildEditionIndex([
      row("vod", "2026-11-17T10:00:00Z", { trigger: "event", input_params: { tickers: ["VOD"] } }),
      row("sched", "2026-11-17T00:41:00Z"),
    ]);
    expect(latestEdition(idx)?.id).toBe("sched");
  });

  it("skips a row with an unreadable timestamp", () => {
    expect(buildEditionIndex([row("x", "not a date")]).editions).toEqual([]);
  });

  it("indexes each desk separately", () => {
    const all = buildEditionIndexes([
      row("r", "2026-11-17T00:41:00Z"),
      row("d", "2026-11-17T18:00:00Z", { agent_name: "dividend" }),
    ]);
    expect(Object.keys(all).sort()).toEqual(["dividend", "reaction"]);
    expect(all.reaction.editions.map((e) => e.id)).toEqual(["r"]);
    expect(deskOfReport(all, "d", "reaction")).toBe("dividend");
    expect(deskOfReport(all, null, "reaction")).toBe("reaction");
    expect(deskOfReport(all, "unknown", "reaction")).toBe("reaction");
  });
});

describe("locateEdition", () => {
  const idx = buildEditionIndex([
    row("e1", "2026-10-08T00:41:00Z"),
    row("e2", "2026-10-09T00:41:00Z"),
    row("od", "2026-10-09T12:03:00Z", { trigger: "event", input_params: { tickers: ["BATS"] } }),
    row("e3", "2026-10-10T00:41:00Z"),
    row("od2", "2026-10-11T09:00:00Z", { trigger: "event", input_params: { tickers: ["VOD"] } }),
  ]);

  it("no id is the reports page: the latest edition", () => {
    const loc = locateEdition(idx, null);
    expect(loc).toMatchObject({ kind: "edition", isLatest: true, next: null });
    expect(loc?.kind === "edition" && [loc.edition.id, loc.prev?.id]).toEqual(["e3", "e2"]);
  });

  it("a middle edition has both neighbours", () => {
    const loc = locateEdition(idx, "e2");
    expect(loc?.kind === "edition" && [loc.prev?.id, loc.next?.id, loc.isLatest]).toEqual([
      "e1",
      "e3",
      false,
    ]);
  });

  it("the first edition has no previous; the latest by id is still the latest", () => {
    expect(locateEdition(idx, "e1")).toMatchObject({ prev: null });
    expect(locateEdition(idx, "e3")).toMatchObject({ isLatest: true, next: null });
  });

  it("an on-demand report sits between the daily editions around it", () => {
    const loc = locateEdition(idx, "od");
    expect(loc?.kind === "extra" && [loc.dayEdition?.id, loc.prev?.id, loc.next?.id]).toEqual([
      "e2",
      "e2",
      "e3",
    ]);
  });

  it("an on-demand report on a day with no edition, after the last one", () => {
    const loc = locateEdition(idx, "od2");
    expect(loc?.kind === "extra" && [loc.dayEdition, loc.prev?.id, loc.next]).toEqual([
      null,
      "e3",
      null,
    ]);
  });

  it("an id the index doesn't hold, or an empty index, is null", () => {
    expect(locateEdition(idx, "nope")).toBeNull();
    expect(locateEdition({ editions: [], extras: [] }, null)).toBeNull();
    expect(locateEdition({ editions: [], extras: [] }, "e1")).toBeNull();
  });
});

describe("calendarWeeks", () => {
  it("November 2026 starts on a Sunday: six Monday-first rows", () => {
    const w = calendarWeeks(2026, 11);
    expect(w).toHaveLength(6);
    expect(w[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(w[1][0]).toBe("2026-11-02");
    expect(w[5]).toEqual(["2026-11-30", null, null, null, null, null, null]);
    expect(w.every((week) => week.length === 7)).toBe(true);
  });

  it("February 2027 starts on a Monday and fits four rows exactly", () => {
    const w = calendarWeeks(2027, 2);
    expect(w).toHaveLength(4);
    expect(w[0][0]).toBe("2027-02-01");
    expect(w[3][6]).toBe("2027-02-28");
  });

  it("a leap February has its 29th", () => {
    expect(calendarWeeks(2028, 2).flat()).toContain("2028-02-29");
    expect(calendarWeeks(2027, 2).flat()).not.toContain("2027-02-29");
  });

  it("month keys step across a year boundary", () => {
    expect(monthKey("2026-11-17")).toBe("2026-11");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("overshootLevel — tercile bins", () => {
  it("has its edges at 1, 4 and 9", () => {
    expect([null, 0, 1, 3, 4, 8, 9, 16].map(overshootLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe("editionFindings", () => {
  const e = { id: "x", date: "2026-11-14" };
  it("states the counts and names, and how many names it isn't showing", () => {
    expect(editionFindings({ ...e, cleared: 5, overshoots: 2, flagged: ["FSLR", "DOCS"] })).toBe(
      "5 cleared the screen · 2 overshoots: FSLR, DOCS",
    );
    expect(
      editionFindings({ ...e, cleared: 23, overshoots: 13, flagged: ["A", "B", "C"] }),
    ).toBe("23 cleared the screen · 13 overshoots: A, B, C +10 more");
    expect(editionFindings({ ...e, cleared: 3, overshoots: 1, flagged: ["COHR"] })).toBe(
      "3 cleared the screen · 1 overshoot: COHR",
    );
  });
  it("says so plainly when nothing was found, or nothing is known", () => {
    expect(editionFindings({ ...e, cleared: 3, overshoots: 0, flagged: [] })).toBe(
      "3 cleared the screen · no overshoot flagged",
    );
    expect(editionFindings({ ...e, cleared: 0, overshoots: 0, flagged: [] })).toBe(
      "nothing cleared the screen",
    );
    expect(editionFindings({ ...e, cleared: null, overshoots: null, flagged: [] })).toBe(
      "edition filed",
    );
  });
});

describe("formatEditionDate / formatMonthLabel", () => {
  it("names the weekday — a Saturday edition is a Saturday", () => {
    expect(formatEditionDate("2026-11-17")).toBe("Tue 17 Nov 2026");
    expect(formatEditionDate("2026-11-14T00:40:41.603+00:00")).toBe("Sat 14 Nov 2026");
    expect(formatEditionDate("2026-11-14", { year: false })).toBe("Sat 14 Nov");
    expect(formatEditionDate("2026-09-04", { long: true })).toBe("Friday 4 September 2026");
    expect(formatEditionDate("nonsense")).toBe("nonsense");
  });
  it("labels a month", () => {
    expect(formatMonthLabel("2026-11")).toBe("November 2026");
    expect(formatMonthLabel("2027-01-15")).toBe("January 2027");
  });
});
