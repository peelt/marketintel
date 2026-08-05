import { describe, expect, it } from "vitest";
import {
  discountToHigh,
  dropSeverity,
  dropStats,
  passesDropScreen,
  returnOverSessions,
  thresholdsFromParams,
  volumeSpike,
  type SessionRow,
} from "@/lib/agents/reaction/metrics";
import {
  classifyReaction,
  describeOnDemandOutcome,
  describeScreenedMove,
  mergeRequestedIntoCohort,
} from "@/lib/agents/reaction/agent";
import {
  describeMacroDriver,
  parseGrade,
  type ReactionNewsGrade,
} from "@/lib/agents/reaction/news";
import { orderForRanking } from "@/lib/agents/base";
import { hostOf, parseNewsEvidence } from "@/lib/format";
import { parseConstituentsTable } from "@/lib/data-sources/index-constituents";
import type { CandidateScore } from "@/lib/scoring/types";

function series(closes: number[], volume = 1000): SessionRow[] {
  return closes.map((close, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    close,
    volume,
  }));
}

describe("return and drop metrics", () => {
  it("computes returns over trading sessions, not calendar days", () => {
    const s = series([100, 100, 100, 100, 100, 90]);
    expect(returnOverSessions(s, 1)).toBeCloseTo(-0.1);
    expect(returnOverSessions(s, 5)).toBeCloseTo(-0.1);
    expect(returnOverSessions(s, 6)).toBeNull(); // not enough history
  });

  it("passesDropScreen honours the settled OR-thresholds", () => {
    const thresholds = thresholdsFromParams({}); // defaults 12 / 8
    // -13% over 5 sessions, quiet 1d → included via the 5d leg
    expect(
      passesDropScreen({ return5d: -0.13, return1d: -0.01 }, thresholds),
    ).toBe(true);
    // -9% in one session → included via the 1d leg
    expect(
      passesDropScreen({ return5d: -0.05, return1d: -0.09 }, thresholds),
    ).toBe(true);
    // -7% / -5% → not included
    expect(
      passesDropScreen({ return5d: -0.07, return1d: -0.05 }, thresholds),
    ).toBe(false);
    // a RISE never screens in
    expect(passesDropScreen({ return5d: 0.13, return1d: 0.09 }, thresholds)).toBe(false);
  });

  it("reads thresholds from framework params and defends against junk", () => {
    expect(
      thresholdsFromParams({ inclusion: { drawdown5dPct: 15, drop1dPct: 10 } }),
    ).toEqual({ drawdown5dPct: 15, drop1dPct: 10 });
    expect(
      thresholdsFromParams({ inclusion: { drawdown5dPct: -3, drop1dPct: "8" } }),
    ).toEqual({ drawdown5dPct: 12, drop1dPct: 8 }); // settled defaults
  });

  it("dropSeverity ranks the hardest fallers first", () => {
    const worse = dropSeverity({ return5d: -0.2, return1d: -0.05 });
    const milder = dropSeverity({ return5d: -0.13, return1d: -0.02 });
    expect(worse).toBeLessThan(milder);
  });

  it("volumeSpike and discountToHigh null out on thin data", () => {
    expect(volumeSpike(series([1, 2, 3]))).toBeNull();
    expect(discountToHigh(series([100, 90]))).toBeNull();
    const s = series(Array(40).fill(100).concat([80]));
    expect(discountToHigh(s)).toBeCloseTo(0.2);
  });

  it("dropStats carries nulls through, never zeros", () => {
    expect(dropStats([])).toEqual({ return1d: null, return5d: null });
  });
});

describe("classifyReaction", () => {
  function scored(composite: number, coverage = 0.8, damage: number | null = 60): CandidateScore {
    return {
      securityId: "s1",
      composite,
      coverage,
      criteria: {
        earned_damage: {
          score: 50,
          signals: {
            news_damage_severity: { raw: damage, normalised: 40, weight: 0.6 },
          },
        },
      },
      evidence: [],
    };
  }
  const stats = { return5d: -0.14, return1d: -0.03 };
  function grade(
    over: Partial<ReactionNewsGrade> = {},
  ): ReactionNewsGrade {
    return {
      damageSeverity: 60,
      disproportion: 70,
      headline: "A 10-for-1 share split took effect on 23 July 2026.",
      summary: "s",
      sources: [],
      confidence: "high",
      corporateAction: "none",
      macroDriver: "unattributed",
      macroTheme: null,
      ...over,
    };
  }

  it("bands the composite into the four verdicts", () => {
    expect(classifyReaction(scored(80), stats).classification).toBe("strong_overshoot");
    expect(classifyReaction(scored(65), stats).classification).toBe("mild_overshoot");
    expect(classifyReaction(scored(50), stats).classification).toBe("proportionate");
    expect(classifyReaction(scored(30), stats).classification).toBe("underreaction");
  });

  it("withholds the verdict below the coverage floor", () => {
    const c = classifyReaction(scored(80, 0.2), stats);
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("withheld");
  });

  it("refuses an overshoot verdict without a news grade — cause_unconfirmed", () => {
    // The live failure: APP ranked #1 "strong overshoot" with NO news evidence
    // — the remaining price signals are circular (big drop ⇒ big overshoot).
    const c = classifyReaction(scored(80, 0.4, null), stats);
    expect(c.classification).toBe("cause_unconfirmed");
    expect(c.verdict).toContain("no news grade");
    expect(c.verdict).toContain("cannot be assessed");
    expect(c.verdict.toLowerCase()).not.toContain("the framework grades");
  });

  it("refuses an overshoot verdict on a corporate action — the fall isn't real", () => {
    // The live failure (CGT, 27 Jul 2026): a 10-for-1 split showed as -90%
    // over 5 sessions against news damage of 2/100 — maximum disproportion by
    // construction — and topped the ranking at 98.4.
    const split = grade({ corporateAction: "confirmed" });
    const c = classifyReaction(scored(98), { return5d: -0.9, return1d: -0.9 }, split);
    expect(c.classification).toBe("corporate_action");
    expect(c.verdict).toContain("corporate action");
    expect(c.verdict).toContain("No overshoot verdict is filed");
    expect(c.verdict.toLowerCase()).not.toContain("disproportionate");
  });

  it("treats a suspected corporate action the same way", () => {
    // If the desk can't say the move was real, it can't call it
    // disproportionate — same rule as a missing news grade.
    const c = classifyReaction(
      scored(98),
      { return5d: -0.5, return1d: -0.5 },
      grade({ corporateAction: "suspected" }),
    );
    expect(c.classification).toBe("corporate_action");
    expect(c.verdict).toContain("no source confirms it");
  });

  it("leaves a genuine fall alone when no corporate action is flagged", () => {
    const c = classifyReaction(scored(80), stats, grade({ corporateAction: "none" }));
    expect(c.classification).toBe("strong_overshoot");
  });

  it("verdict text is factual and impersonal (I2)", () => {
    const c = classifyReaction(scored(80), stats);
    expect(c.verdict).toContain("-14.0% over 5 sessions");
    expect(c.verdict).toContain("60/100");
    for (const banned of ["you should", "buy", "sell", "your "]) {
      expect(c.verdict.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("describeScreenedMove (verdicts quote the leg that cleared)", () => {
  const t = { drawdown5dPct: 12, drop1dPct: 8 };

  it("quotes the 1-day fall when the 5-session return is positive", () => {
    // The filed regression: LITE qualified on the day leg while UP 4.1% over
    // 5 sessions — the verdict read "grades +4.1% over 5 sessions" nonsense.
    expect(
      describeScreenedMove({ return5d: 0.041, return1d: -0.09 }, t),
    ).toBe("-9.0% in a session");
  });

  it("quotes the 5-session leg when that is what cleared", () => {
    expect(
      describeScreenedMove({ return5d: -0.14, return1d: -0.03 }, t),
    ).toBe("-14.0% over 5 sessions");
  });

  it("quotes the more severe leg when both cleared", () => {
    expect(
      describeScreenedMove({ return5d: -0.31, return1d: -0.1 }, t),
    ).toBe("-31.0% over 5 sessions");
    expect(
      describeScreenedMove({ return5d: -0.13, return1d: -0.2 }, t),
    ).toBe("-20.0% in a session");
  });

  it("falls back to the worse actual move, then a neutral phrase", () => {
    expect(
      describeScreenedMove({ return5d: -0.05, return1d: -0.02 }, t),
    ).toBe("-5.0% over 5 sessions");
    expect(describeScreenedMove(null, t)).toBe("the screened decline");
  });
});

describe("news grade parsing", () => {
  const valid = {
    damage_severity: 35,
    disproportion: 78,
    headline: "Guidance trimmed on FX headwinds",
    summary: "The company cut FY guidance by 3% on currency effects.",
    sources: [{ url: "https://example.com/a", title: "Report" }],
    confidence: "high",
  };

  it("accepts a valid grade and rounds scores", () => {
    const g = parseGrade(JSON.stringify({ ...valid, damage_severity: 35.4 }));
    expect(g).not.toBeNull();
    expect(g!.damageSeverity).toBe(35);
    expect(g!.disproportion).toBe(78);
    expect(g!.sources).toHaveLength(1);
  });

  it("reads the corporate-action flag, defaulting to none", () => {
    expect(parseGrade(JSON.stringify(valid))!.corporateAction).toBe("none");
    expect(
      parseGrade(JSON.stringify({ ...valid, corporate_action: "confirmed" }))!
        .corporateAction,
    ).toBe("confirmed");
    expect(
      parseGrade(JSON.stringify({ ...valid, corporate_action: "suspected" }))!
        .corporateAction,
    ).toBe("suspected");
    // The flag pulls a name out of the ranking, so it must be positively
    // asserted — anything unrecognised means "the shares genuinely fell".
    expect(
      parseGrade(JSON.stringify({ ...valid, corporate_action: "maybe?" }))!
        .corporateAction,
    ).toBe("none");
  });

  it("rejects out-of-range grades, bad confidence, and non-JSON", () => {
    expect(parseGrade(JSON.stringify({ ...valid, damage_severity: 130 }))).toBeNull();
    expect(parseGrade(JSON.stringify({ ...valid, confidence: "certain" }))).toBeNull();
    expect(parseGrade("the stock fell because…")).toBeNull();
  });
});

describe("constituents table parsing", () => {
  const SP_STYLE = `
    <table id="constituents" class="wikitable">
      <tr><th>Symbol</th><th>Security</th><th>GICS Sector</th></tr>
      <tr><td><a href="/x">MMM</a></td><td><a href="/y">3M</a></td><td>Industrials</td></tr>
      <tr><td>BRK.B</td><td>Berkshire Hathaway</td><td>Financials</td></tr>
    </table>`;

  const FTSE_STYLE = `
    <table id="constituents" class="wikitable">
      <tr><th>Company</th><th>Ticker</th><th>FTSE industry</th></tr>
      <tr><td>Aviva</td><td>AV.</td><td>Insurance</td></tr>
      <tr><td>BT Group</td><td>BT.A</td><td>Telecoms</td></tr>
    </table>`;

  it("parses the S&P layout (ticker first)", () => {
    const rows = parseConstituentsTable(SP_STYLE, {
      tickerHeader: "symbol",
      nameHeader: "security",
    });
    expect(rows).toEqual([
      { ticker: "MMM", name: "3M" },
      { ticker: "BRK.B", name: "Berkshire Hathaway" },
    ]);
  });

  it("parses the FTSE layout (company first) including dotted tickers", () => {
    const rows = parseConstituentsTable(FTSE_STYLE, {
      tickerHeader: "ticker",
      nameHeader: "company",
    });
    expect(rows).toEqual([
      { ticker: "AV.", name: "Aviva" },
      { ticker: "BT.A", name: "BT Group" },
    ]);
  });

  it("returns [] when the table or expected headers are missing", () => {
    expect(
      parseConstituentsTable("<table id='other'></table>", {
        tickerHeader: "symbol",
        nameHeader: "security",
      }),
    ).toEqual([]);
    expect(
      parseConstituentsTable(SP_STYLE, {
        tickerHeader: "epic",
        nameHeader: "issuer",
      }),
    ).toEqual([]);
  });
});

describe("orderForRanking with a demotion predicate", () => {
  it("demotes news-less names below fully-evidenced ones regardless of composite", () => {
    // Mirrors ReactionAgent.demoteFromRanking: missing news grade → demoted.
    const scored = [
      { securityId: "no-news-high", composite: 74.3, coverage: 0.4, hasNews: false },
      { securityId: "news-mid", composite: 69.8, coverage: 0.82, hasNews: true },
      { securityId: "news-low", composite: 42.2, coverage: 0.4, hasNews: true },
    ];
    const ordered = orderForRanking(scored, (s) => !s.hasNews);
    expect(ordered.map((s) => s.securityId)).toEqual([
      "news-mid",
      "news-low",
      "no-news-high",
    ]);
  });
});

describe("news evidence parsing (report presentation)", () => {
  it("parses the persisted evidence shape into headline/summary/sources", () => {
    const text =
      "[AXON · damage 15/100 · high] Axon fell after a speculative rally unwound.\n\n" +
      "Shares gave back part of a preceding 40% rally with no new negative catalyst. Valuation remained the core pressure point.\n\n" +
      "Sources:\nAxon Shares Drop $6 Billion — https://ts2.tech/en/axon-shares\nAXON Registers a Bigger Fall — https://sg.finance.yahoo.com/news/axon";
    const p = parseNewsEvidence(text);
    expect(p).not.toBeNull();
    expect(p!.ticker).toBe("AXON");
    expect(p!.gradeLabel).toBe("damage");
    expect(p!.grade).toBe(15);
    expect(p!.confidence).toBe("high");
    expect(p!.headline).toContain("speculative rally");
    expect(p!.summary).toContain("Valuation remained");
    expect(p!.sources).toEqual([
      { title: "Axon Shares Drop $6 Billion", url: "https://ts2.tech/en/axon-shares" },
      { title: "AXON Registers a Bigger Fall", url: "https://sg.finance.yahoo.com/news/axon" },
    ]);
  });

  it("returns null for non-matching text so callers fall back to plain rendering", () => {
    expect(parseNewsEvidence("just some derived metric text")).toBeNull();
  });

  it("parses the REAL macro-attribution head (the raw-URL regression)", () => {
    // The persisted driver is describeMacroDriver's output: a hyphenated word
    // AND its own "·" before a free-text theme. Two earlier fixes assumed a
    // single token like "macro_driven" and still failed on every live row, so
    // this test uses the exact production shape.
    const text =
      "[FICO · damage 20/100 · high · macro-amplified · AI infrastructure / chip stock volatility] " +
      "Fair Isaac slid on mixed quarterly results.\n\n" +
      "Sources:\nWhy Fair Isaac Stock Is Trading Lower - StockStory — https://stockstory.org/us/stocks/nyse/fico";
    const p = parseNewsEvidence(text);
    expect(p).not.toBeNull();
    expect(p!.ticker).toBe("FICO");
    expect(p!.gradeLabel).toBe("damage");
    expect(p!.grade).toBe(20);
    expect(p!.confidence).toBe("high");
    expect(p!.driver).toBe(
      "macro-amplified · AI infrastructure / chip stock volatility",
    );
    expect(p!.sources).toEqual([
      {
        title: "Why Fair Isaac Stock Is Trading Lower - StockStory",
        url: "https://stockstory.org/us/stocks/nyse/fico",
      },
    ]);
  });

  it("parses every head shape the producer can emit (drift guard)", () => {
    // Composed through the REAL producer so a change to describeMacroDriver
    // fails here rather than silently degrading the card in production.
    const cases: [string | null, string | null][] = [
      ["macro_driven", "Fed rate-hike repricing"],
      ["macro_amplified", "AI capex rotation and semis"],
      ["idiosyncratic", null],
      ["unattributed", null],
    ];
    for (const [driverKind, theme] of cases) {
      const driver = describeMacroDriver(
        driverKind as Parameters<typeof describeMacroDriver>[0],
        theme,
      );
      const text = `[TEST · damage 40/100 · medium${driver ? ` · ${driver}` : ""}] Headline.\n\nBody.`;
      const p = parseNewsEvidence(text);
      expect(p, `failed for driver=${driver}`).not.toBeNull();
      expect(p!.ticker).toBe("TEST");
      expect(p!.grade).toBe(40);
      expect(p!.confidence).toBe("medium");
      expect(p!.driver).toBe(driver);
    }
  });

  it("keeps em-dashes inside a headline instead of truncating the title", () => {
    const p = parseNewsEvidence(
      "[X · damage 10/100 · low] H.\n\nSources:\n" +
        "Kioxia's miss — what it means — for memory — https://ft.com/a",
    );
    expect(p!.sources[0]).toEqual({
      title: "Kioxia's miss — what it means — for memory",
      url: "https://ft.com/a",
    });
  });

  it("still parses pre-macro rows and other desks' grade labels", () => {
    const old = parseNewsEvidence("[AXON · damage 15/100 · high] Headline.");
    expect(old!.driver).toBeNull();
    const metals = parseNewsEvidence("[AEM · cost margin 80/100 · medium] Headline.");
    expect(metals!.gradeLabel).toBe("cost margin");
    expect(metals!.grade).toBe(80);
  });

  it("dedupes syndicated sources by URL and by matching headline", () => {
    const text =
      "[SNDK · damage 35/100 · high] Headline.\n\n" +
      "Sources:\n" +
      "Kioxia's outlook miss clouds optimism — https://japantimes.co.jp/kioxia\n" +
      "Kioxia's Outlook Miss Clouds Optimism — https://bloomberg.com/kioxia-story\n" +
      "Kioxia's outlook miss clouds optimism — https://japantimes.co.jp/kioxia\n" +
      "A different story — https://ft.com/other";
    const p = parseNewsEvidence(text);
    expect(p!.sources.map((s) => s.url)).toEqual([
      "https://japantimes.co.jp/kioxia",
      "https://ft.com/other",
    ]);
  });

  it("hostOf strips www and survives junk", () => {
    expect(hostOf("https://www.ft.com/content/abc")).toBe("ft.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});

describe("on-demand analysis (scoped runs)", () => {
  const thresholds = { drawdown5dPct: 12, drop1dPct: 8 };

  it("answers factually when the ticker isn't in the universe", () => {
    const text = describeOnDemandOutcome(
      { ticker: "ZZZZ", matched: false, passed: false, stats: null },
      thresholds,
    );
    expect(text).toContain("ZZZZ");
    expect(text).toContain("isn't in the Reaction universe");
  });

  it("reports the actual moves and thresholds when the drop doesn't qualify", () => {
    const text = describeOnDemandOutcome(
      {
        ticker: "AAPL",
        matched: true,
        passed: false,
        stats: { return5d: -0.042, return1d: -0.011 },
      },
      thresholds,
    );
    expect(text).toContain("-4.2% over 5 sessions");
    expect(text).toContain("-1.1% on the day");
    expect(text).toContain("12%");
    expect(text).toContain("8%");
    expect(text).toContain("no overshoot verdict is filed");
  });

  it("names the qualifying move when the screen passes", () => {
    const text = describeOnDemandOutcome(
      {
        ticker: "NXT.L",
        matched: true,
        passed: true,
        stats: { return5d: -0.142, return1d: -0.03 },
      },
      thresholds,
    );
    expect(text).toContain("cleared the drop screen");
    expect(text).toContain("-14.2% over 5 sessions");
  });

  it("says so when there's too little price history to screen", () => {
    const text = describeOnDemandOutcome(
      {
        ticker: "NEWCO",
        matched: true,
        passed: false,
        stats: { return5d: null, return1d: null },
      },
      thresholds,
    );
    expect(text).toContain("too little recent price history");
  });

  it("mergeRequestedIntoCohort force-includes without duplicating or reordering", () => {
    expect(mergeRequestedIntoCohort(["a", "b"], ["b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(mergeRequestedIntoCohort([], ["x"])).toEqual(["x"]);
    expect(mergeRequestedIntoCohort(["a"], [])).toEqual(["a"]);
  });
});
