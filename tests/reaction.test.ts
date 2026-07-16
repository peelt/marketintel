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
import { classifyReaction } from "@/lib/agents/reaction/agent";
import { parseGrade } from "@/lib/agents/reaction/news";
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

  it("verdict text is factual and impersonal (I2)", () => {
    const c = classifyReaction(scored(80), stats);
    expect(c.verdict).toContain("-14.0% over 5 sessions");
    expect(c.verdict).toContain("60/100");
    for (const banned of ["you should", "buy", "sell", "your "]) {
      expect(c.verdict.toLowerCase()).not.toContain(banned);
    }
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
    expect(p!.damage).toBe(15);
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

  it("hostOf strips www and survives junk", () => {
    expect(hostOf("https://www.ft.com/content/abc")).toBe("ft.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});
