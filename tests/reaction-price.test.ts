import { describe, expect, it } from "vitest";
import {
  buildReactionPriceContext,
  chartGeometry,
  priceFormatter,
  quoteCaption,
  shiftIsoDate,
  type PriceRowInput,
} from "@/lib/reports/reaction-price";
import {
  criterionExplainer,
  criterionLabel,
  criterionShortLabel,
  formatPrice,
  formatShortDate,
} from "@/lib/format";

/** Weekday closes from `start` for `n` sessions, priced by `price(i)`. */
function sessions(
  start: string,
  n: number,
  price: (i: number) => number,
  currency: string | null = "USD",
): PriceRowInput[] {
  const out: PriceRowInput[] = [];
  let d = start;
  while (out.length < n) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push({ date: d, close: price(out.length), currency });
    d = shiftIsoDate(d, 1);
  }
  return out;
}

const opts = { sessions: 5, fallbackCurrency: "USD" };

describe("buildReactionPriceContext", () => {
  // A year+ of flat 400s, a 5-session fall to ~300 ending 11 Nov 2026, then
  // two closes after the edition.
  const flat = sessions("2025-10-01", 290, () => 400);
  const lastFlat = flat[flat.length - 1].date;
  const fall = sessions(shiftIsoDate(lastFlat, 1), 5, (i) => 380 - i * 20); // 380..300
  const rows = [...flat, ...fall];
  const screenedDate = fall[fall.length - 1].date;

  it("finds the graded close, the window start N sessions back, and the move since", () => {
    const after = sessions(shiftIsoDate(screenedDate, 1), 2, (i) => 303 + i * 0.03);
    const ctx = buildReactionPriceContext([...rows, ...after], { ...opts, screenedDate })!;
    expect(ctx.screened).toEqual({ date: screenedDate, close: 300 });
    expect(ctx.windowStart).toEqual({ date: lastFlat, close: 400 });
    expect(ctx.latest?.date).toBe(after[1].date);
    expect(ctx.latest?.sinceFraction).toBeCloseTo(303.03 / 300 - 1, 10);
    expect(ctx.currency).toBe("USD");
  });

  it("measures the 52-week high to the GRADED close, not to today", () => {
    // A later rally above the old high must not move the high the
    // repricing criterion was measured against.
    const after = sessions(shiftIsoDate(screenedDate, 1), 3, () => 900);
    const ctx = buildReactionPriceContext([...rows, ...after], { ...opts, screenedDate })!;
    expect(ctx.high52?.close).toBe(400);
    expect(ctx.high52?.belowFraction).toBeCloseTo(0.25, 10);
  });

  it("names the date the 52-week high was FIRST set", () => {
    const ctx = buildReactionPriceContext(rows, { ...opts, screenedDate })!;
    // The flat run's first close inside the year window.
    expect(ctx.high52?.date).toBe(
      rows.find((r) => r.date > shiftIsoDate(screenedDate, -365))!.date,
    );
  });

  it("withholds the 52-week high on under a year of history", () => {
    const short = rows.slice(-100);
    const ctx = buildReactionPriceContext(short, { ...opts, screenedDate })!;
    expect(ctx.high52).toBeNull();
  });

  it("latest is null when nothing has closed since the edition", () => {
    const ctx = buildReactionPriceContext(rows, { ...opts, screenedDate })!;
    expect(ctx.latest).toBeNull();
  });

  it("anchors to the last close on or before the graded date (a weekend date)", () => {
    // 2026-11-14 is a Saturday: the graded close is Friday's.
    const r = sessions("2026-10-01", 34, (i) => 100 + i);
    const ctx = buildReactionPriceContext(r, { ...opts, screenedDate: "2026-11-14" })!;
    expect(ctx.screened.date).toBe("2026-11-13");
  });

  it("returns null when the series has a hole where the verdict sits", () => {
    const r = sessions("2026-01-05", 40, () => 50); // ends late Feb
    expect(
      buildReactionPriceContext(r, { ...opts, screenedDate: "2026-11-11" }),
    ).toBeNull();
    expect(buildReactionPriceContext([], { ...opts, screenedDate: "2026-11-11" })).toBeNull();
  });

  it("converts pence to pounds — the 100× trap", () => {
    const r = sessions("2026-10-01", 30, () => 1234, "GBp");
    const ctx = buildReactionPriceContext(r, {
      ...opts,
      screenedDate: r[r.length - 1].date,
    })!;
    expect(ctx.currency).toBe("GBP");
    expect(ctx.screened.close).toBeCloseTo(12.34, 10);
  });

  it("uses the security's currency for pre-0004 rows with none recorded", () => {
    const r = sessions("2026-10-01", 30, () => 1234, null);
    const ctx = buildReactionPriceContext(r, {
      sessions: 5,
      fallbackCurrency: "GBp",
      screenedDate: r[r.length - 1].date,
    })!;
    expect(ctx.currency).toBe("GBP");
    expect(ctx.screened.close).toBeCloseTo(12.34, 10);
  });

  it("drops rows in another currency rather than charting a fake cliff", () => {
    const usd = sessions("2026-10-01", 20, () => 10, "USD");
    const gbp = sessions(shiftIsoDate(usd[usd.length - 1].date, 1), 10, () => 800, "GBp");
    const ctx = buildReactionPriceContext([...usd, ...gbp], {
      ...opts,
      screenedDate: gbp[gbp.length - 1].date,
    })!;
    expect(ctx.chart.every((p) => p.close === 8)).toBe(true);
  });

  it("ignores non-positive and non-finite closes (missing ≠ zero)", () => {
    const r = sessions("2026-10-01", 20, (i) => (i === 10 ? 0 : 50));
    r.push({ date: "2026-11-30", close: Number.NaN, currency: "USD" });
    const ctx = buildReactionPriceContext(r, { ...opts, screenedDate: r[18].date })!;
    expect(ctx.chart.some((p) => p.close <= 0)).toBe(false);
    expect(ctx.latest?.date).toBe(r[19].date);
  });

  it("no window start when the verdict names no window, or history is too short", () => {
    expect(
      buildReactionPriceContext(rows, { ...opts, sessions: null, screenedDate })!.windowStart,
    ).toBeNull();
    const tiny = rows.slice(-3);
    expect(
      buildReactionPriceContext(tiny, { ...opts, screenedDate })!.windowStart,
    ).toBeNull();
  });

  it("charts about three months before the graded close, through the latest", () => {
    const after = sessions(shiftIsoDate(screenedDate, 1), 4, () => 310);
    const ctx = buildReactionPriceContext([...rows, ...after], { ...opts, screenedDate })!;
    expect(ctx.chart[0].date >= shiftIsoDate(screenedDate, -92)).toBe(true);
    expect(ctx.chart[0].date <= shiftIsoDate(screenedDate, -88)).toBe(true);
    expect(ctx.chart[ctx.chart.length - 1].date).toBe(after[3].date);
  });
});

describe("chartGeometry", () => {
  it("spaces by session and pads the extremes off the frame", () => {
    const g = chartGeometry([
      { date: "2026-11-06", close: 10 },
      { date: "2026-11-09", close: 20 }, // a weekend between: no gap
      { date: "2026-11-10", close: 15 },
    ]);
    expect(g.x("2026-11-06")).toBe(0);
    expect(g.x("2026-11-09")).toBe(0.5);
    expect(g.x("2026-11-10")).toBe(1);
    expect(g.x("2026-11-07")).toBeNull();
    expect(g.y(20)).toBeCloseTo(0.1, 10); // max → top pad
    expect(g.y(10)).toBeCloseTo(0.9, 10); // min → bottom pad
  });

  it("a flat series sits mid-height instead of dividing by zero", () => {
    const g = chartGeometry([
      { date: "2026-11-06", close: 5 },
      { date: "2026-11-09", close: 5 },
    ]);
    expect(g.y(5)).toBe(0.5);
  });
});

describe("price + criterion formatting", () => {
  it("formats a price like a broker: narrow symbol, always two decimals", () => {
    expect(formatPrice(308.88, "USD")).toBe("$308.88");
    expect(formatPrice(1204, "USD")).toBe("$1,204.00");
    expect(formatPrice(12.3456, "GBP")).toBe("£12.35");
    expect(formatPrice(null, "USD")).toBe("—");
    expect(formatPrice(Number.NaN, "USD")).toBe("—");
    // An unknown code must not throw mid-render.
    expect(formatPrice(3, "NOT A CODE")).toBe("3.00 NOT A CODE");
  });

  it("short dates drop the year", () => {
    expect(formatShortDate("2026-11-04")).toBe("4 Nov");
  });

  it("earned_damage reads as what it scores: light news damage", () => {
    expect(criterionLabel("earned_damage")).toBe("Light news damage");
    expect(criterionShortLabel("earned_damage")).toBe("light news");
    expect(criterionLabel("some_retired_key")).toBe("some retired key");
  });

  it("states the news grade exactly — the score is 100 minus it", () => {
    expect(criterionExplainer("earned_damage", { news_damage_severity: 62 })).toContain(
      "(38/100)",
    );
    expect(criterionExplainer("earned_damage", { news_damage_severity: null })).not.toContain(
      "/100",
    );
    expect(criterionExplainer("excess_decline", {})).toMatch(/median move/);
    expect(criterionExplainer("unknown_key", {})).toBeNull();
  });
});

describe("priceFormatter", () => {
  it("quotes a pence-priced name in pence, as a UK broker does", () => {
    const r = sessions("2026-10-01", 30, () => 53.4, "GBp");
    const ctx = buildReactionPriceContext(r, {
      sessions: 5,
      fallbackCurrency: null,
      screenedDate: r[r.length - 1].date,
    })!;
    expect(ctx.quotedInPence).toBe(true);
    expect(quoteCaption(ctx)).toBe("pence");
    expect(priceFormatter(ctx)(ctx.screened.close)).toBe("53.40p");
    expect(priceFormatter(ctx)(123.45)).toBe("12,345.00p");
  });

  it("quotes everything else in its currency", () => {
    const ctx = { currency: "USD", quotedInPence: false };
    expect(priceFormatter(ctx)(308.88)).toBe("$308.88");
    expect(quoteCaption(ctx)).toBe("USD");
  });
});
