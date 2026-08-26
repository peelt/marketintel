import { describe, expect, it } from "vitest";
import {
  classificationLabel,
  compositeDisplay,
  confidenceWord,
  criterionShortLabel,
  dropDisplay,
  editionListLine,
  firstSentences,
  formatPriceDate,
  parseVerdictDrop,
  pluralizeCounts,
  isPlaceholderTicker,
  priceChangeSummary,
  dayChangeFraction,
  humanizeDateTime,
  humanizeSchedule,
  nextRunLabel,
  securityDisplayLabel,
  securitySecondaryLabel,
  stripInlineMarkdown,
} from "@/lib/format";
import { radarPoints } from "@/lib/radar";

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

describe("parseVerdictDrop", () => {
  it("reads the 5-session move a filed verdict quotes, stamp and all", () => {
    expect(
      parseVerdictDrop(
        "The framework grades -19.2% over 5 sessions (as of the 19 Aug 2026 close) against news damage graded 25/100 as somewhat disproportionate.",
      ),
    ).toEqual({ pct: -19.2, sessions: 5 });
  });

  it("reads the 1-day leg", () => {
    expect(
      parseVerdictDrop("The framework grades -9.0% in a session against …"),
    ).toEqual({ pct: -9, sessions: 1 });
  });

  it("finds the move mid-sentence in underreaction verdicts", () => {
    expect(
      parseVerdictDrop(
        "The framework grades the identified damage as heavier than -14.0% over 5 sessions reflects.",
      ),
    ).toEqual({ pct: -14, sessions: 5 });
  });

  it("returns null when no move is quoted — the cell shows a dash, not a number", () => {
    expect(parseVerdictDrop(null)).toBeNull();
    expect(
      parseVerdictDrop(
        "AAPL was requested on demand but has too little recent price history to screen.",
      ),
    ).toBeNull();
  });

  it("formats for the table cell", () => {
    expect(dropDisplay({ pct: -19.2, sessions: 5 })).toBe("-19.2% / 5d");
    expect(dropDisplay({ pct: -9, sessions: 1 })).toBe("-9.0% / 1d");
  });
});

describe("firstSentences", () => {
  it("takes the first non-empty line and caps long ones", () => {
    expect(firstSentences("\n\nFirst line.\nSecond.")).toBe("First line.");
    expect(firstSentences("x".repeat(300)).length).toBe(220);
    expect(firstSentences("x".repeat(300)).endsWith("…")).toBe(true);
  });
});

describe("pluralizeCounts / editionListLine", () => {
  it("normalises printf plurals in already-filed summaries", () => {
    expect(pluralizeCounts("Framework flags 3 move(s) as overshoot.")).toBe(
      "Framework flags 3 moves as overshoot.",
    );
    expect(pluralizeCounts("1 drop(s) unranked")).toBe("1 drop unranked");
    expect(pluralizeCounts("no counts here")).toBe("no counts here");
    // The count can sit a word or two before the noun.
    expect(pluralizeCounts("2 of 4 graded drop(s) trace to the macro backdrop")).toBe(
      "2 of 4 graded drops trace to the macro backdrop",
    );
    expect(pluralizeCounts("1 screened fall(s) were corporate actions")).toBe(
      "1 screened fall were corporate actions",
    );
  });

  it("drops the identical screened-count prefix for archive rows", () => {
    expect(
      editionListLine(
        "853 names screened; 8 cleared the drop threshold. Framework flags 3 move(s) as overshoot: **COHR**.",
      ),
    ).toBe(
      "8 cleared the drop threshold. Framework flags 3 moves as overshoot: **COHR**.",
    );
    // A summary without the prefix passes through untouched.
    expect(editionListLine("No qualifying drops this run.")).toBe(
      "No qualifying drops this run.",
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
  it("maps machine enums to plain reader phrases", () => {
    expect(classificationLabel("insufficient_data")).toBe("not enough data");
    expect(classificationLabel("cause_unconfirmed")).toBe("cause not yet confirmed");
    expect(classificationLabel("shell_or_blank_check")).toBe("shell / blank cheque");
  });
});

describe("confidenceWord", () => {
  it("bands a 0-1 confidence into a reader word", () => {
    expect(confidenceWord(0.9)).toBe("high");
    expect(confidenceWord(0.8)).toBe("high");
    expect(confidenceWord(0.6)).toBe("medium");
    expect(confidenceWord(0.5)).toBe("medium");
    expect(confidenceWord(0.3)).toBe("low");
  });
});

describe("formatPriceDate", () => {
  it("formats YYYY-MM-DD as day-month-year, timezone-independent", () => {
    expect(formatPriceDate("2025-07-21")).toBe("21 Jul 2025");
    expect(formatPriceDate("2026-01-05")).toBe("5 Jan 2026");
    expect(formatPriceDate("2026-12-31T00:00:00Z")).toBe("31 Dec 2026");
  });
  it("falls back to the raw string when it isn't a plain date", () => {
    expect(formatPriceDate("n/a")).toBe("n/a");
  });
});

describe("dayChangeFraction", () => {
  it("computes change against the prior value", () => {
    // value 1010 after a +10 day = +10/1000 = +1%
    expect(dayChangeFraction(1010, 10)).toBeCloseTo(0.01);
    expect(dayChangeFraction(990, -10)).toBeCloseTo(-0.01);
  });
  it("nulls out rather than fabricating a percentage", () => {
    expect(dayChangeFraction(null, 10)).toBeNull();
    expect(dayChangeFraction(1010, null)).toBeNull();
    expect(dayChangeFraction(5, 10)).toBeNull(); // prior would be negative
  });
});

describe("compositeDisplay", () => {
  it("renders a real composite to one decimal", () => {
    expect(compositeDisplay(71.66, 0.82)).toBe("71.7");
    expect(compositeDisplay(0, 0.5)).toBe("0.0"); // a genuine 0 WITH data stays 0.0
  });
  it("renders — when coverage is 0 (missing ≠ zero), never a fabricated 0.0", () => {
    expect(compositeDisplay(0, 0)).toBe("—");
    expect(compositeDisplay(42, 0)).toBe("—");
  });
  it("renders — for a null/absent composite or coverage rather than crashing", () => {
    expect(compositeDisplay(null, 0.5)).toBe("—");
    expect(compositeDisplay(50, null)).toBe("—");
    expect(compositeDisplay(undefined, undefined)).toBe("—");
  });
});

describe("priceChangeSummary", () => {
  it("computes a normal change with direction", () => {
    expect(priceChangeSummary(100, 110)).toEqual({ pct: 10, direction: "up" });
    expect(priceChangeSummary(100, 90)).toEqual({ pct: -10, direction: "down" });
  });
  it("guards a zero/negative first close — no Infinity/NaN%", () => {
    expect(priceChangeSummary(0, 50)).toEqual({ pct: null, direction: "flat" });
    expect(priceChangeSummary(-5, 50)).toEqual({ pct: null, direction: "flat" });
  });
  it("reads a rounding-to-zero change as flat, not a false up/down", () => {
    expect(priceChangeSummary(100, 100).direction).toBe("flat");
    expect(priceChangeSummary(100, 100.02).direction).toBe("flat"); // +0.02% → flat
  });
});

describe("criterionShortLabel", () => {
  it("maps known framework criteria and falls back to the first word", () => {
    expect(criterionShortLabel("cost_position")).toBe("cost");
    expect(criterionShortLabel("coverage_and_sustainability")).toBe("cover");
    expect(criterionShortLabel("some_new_criterion")).toBe("some");
  });
});

describe("radarPoints", () => {
  it("starts at 12 o'clock and scales by score", () => {
    const pts = radarPoints([100, 50, 50], 50, 0);
    // First vertex: full radius straight up from center (0,-50).
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[0].y).toBeCloseTo(-50, 5);
    // All points within the radius.
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(50.0001);
    }
  });
  it("clamps out-of-range scores instead of drawing outside the grid", () => {
    const pts = radarPoints([150, -20, 50], 50, 0);
    expect(Math.hypot(pts[0].x, pts[0].y)).toBeCloseTo(50, 5);
    expect(Math.hypot(pts[1].x, pts[1].y)).toBeCloseTo(0, 5);
  });
});

describe("security display labels (CIK placeholders)", () => {
  const listed = { ticker: "NVDA", name: "NVIDIA Corporation" };
  const preListing = { ticker: "CIK2102720", name: "Benzai Holdings" };

  it("recognises CIK placeholder tickers only", () => {
    expect(isPlaceholderTicker("CIK2102720")).toBe(true);
    expect(isPlaceholderTicker("NVDA")).toBe(false);
    // A real ticker that merely starts with CIK-ish letters is not a placeholder.
    expect(isPlaceholderTicker("CIK")).toBe(false);
    expect(isPlaceholderTicker("CIKX1")).toBe(false);
  });

  it("listed names lead with the ticker, name as the secondary", () => {
    expect(securityDisplayLabel(listed)).toBe("NVDA");
    expect(securitySecondaryLabel(listed)).toBe("NVIDIA Corporation");
  });

  it("pre-listing issuers lead with the company name — never a raw CIK", () => {
    expect(securityDisplayLabel(preListing)).toBe("Benzai Holdings");
    expect(securitySecondaryLabel(preListing)).toBe("pre-listing · no ticker yet");
  });

  it("falls back to the raw ticker when no name exists (never blank)", () => {
    expect(securityDisplayLabel({ ticker: "CIK99", name: null })).toBe("CIK99");
    expect(securitySecondaryLabel({ ticker: "CIK99", name: null })).toBe("CIK99");
  });
});
