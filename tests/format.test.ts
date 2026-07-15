import { describe, expect, it } from "vitest";
import {
  classificationLabel,
  humanizeDateTime,
  humanizeSchedule,
  nextRunLabel,
  stripInlineMarkdown,
} from "@/lib/format";

describe("humanizeSchedule", () => {
  it("translates the product's real crons", () => {
    expect(humanizeSchedule("0 17 * * 2,5")).toBe("Tue & Fri, 17:00 UTC");
    expect(humanizeSchedule("0 18 * * 5")).toBe("Fri, 18:00 UTC");
    expect(humanizeSchedule("30 21 * * 1-5")).toBe("weekdays, 21:30 UTC");
    expect(humanizeSchedule("0 18 * * 0")).toBe("Sun, 18:00 UTC");
  });

  it("falls back to the raw string rather than guessing", () => {
    expect(humanizeSchedule("*/5 * * * *")).toBe("*/5 * * * *");
  });
});

describe("nextRunLabel", () => {
  // Wed 15 Jul 2026, 12:00 UTC.
  const from = new Date("2026-07-15T12:00:00Z");

  it("finds the next firing day", () => {
    expect(nextRunLabel("0 17 * * 2,5", from)).toBe("Fri 17:00 UTC");
    expect(nextRunLabel("0 18 * * 5", from)).toBe("Fri 18:00 UTC");
  });

  it("says today when the firing is later the same day", () => {
    expect(nextRunLabel("0 17 * * 3", from)).toBe("today 17:00 UTC");
  });

  it("rolls to next week when today's firing already passed", () => {
    const late = new Date("2026-07-15T18:00:00Z");
    expect(nextRunLabel("0 17 * * 3", late)).toBe("Wed 17:00 UTC");
  });

  it("returns null for shapes it can't handle", () => {
    expect(nextRunLabel("*/5 * * * *", from)).toBeNull();
  });
});

describe("stripInlineMarkdown", () => {
  it("removes the exact leak seen live — bold tickers in list summaries", () => {
    expect(
      stripInlineMarkdown("Top ranked: **BCS** (100.0), **LYG** (92.9)."),
    ).toBe("Top ranked: BCS (100.0), LYG (92.9).");
  });

  it("handles headings, italics, links and code", () => {
    expect(stripInlineMarkdown("# Title\n_em_ and *star* and [x](http://y) and `c`")).toBe(
      "Title\nem and star and x and c",
    );
  });
});

describe("humanizeDateTime", () => {
  const now = new Date("2026-07-15T22:00:00Z");
  it("relative for today and yesterday, dated otherwise", () => {
    expect(humanizeDateTime("2026-07-15T21:11:00Z", now)).toBe("today, 21:11");
    expect(humanizeDateTime("2026-07-14T09:02:00Z", now)).toBe("yesterday, 09:02");
    expect(humanizeDateTime("2026-07-01T10:30:00Z", now)).toBe("01 Jul, 10:30");
    expect(humanizeDateTime("2025-12-31T10:30:00Z", now)).toBe("31 Dec 2025, 10:30");
  });
});

describe("classificationLabel", () => {
  it("de-snakes the vocabulary", () => {
    expect(classificationLabel("elevated_cut_risk")).toBe("elevated cut risk");
  });
});
