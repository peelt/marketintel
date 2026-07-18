import { describe, expect, it } from "vitest";
import {
  isStale,
  latestSessionDate,
  PRICE_STALE_DAYS,
} from "@/lib/data-sources/staleness";
import { dailyPriceUniverse } from "@/lib/inngest/functions/reaction";
import { fundamentalsUniverse } from "@/lib/inngest/functions/refresh";
import { allSeedSecurities } from "@/lib/data-sources/universes";

describe("isStale", () => {
  const asOf = "2026-07-18";
  it("tolerates the normal 1–3 day lag (weekend/holiday closes)", () => {
    expect(isStale("2026-07-17", asOf, 10)).toBe(false);
    expect(isStale("2026-07-15", asOf, 10)).toBe(false);
  });
  it("catches genuinely stale data (a failed refresh weeks old)", () => {
    expect(isStale("2026-07-01", asOf, 10)).toBe(true);
    expect(isStale("2026-06-01", asOf, 10)).toBe(true);
  });
  it("boundary: exactly maxDays is fresh, one more is stale", () => {
    expect(isStale("2026-07-08", asOf, 10)).toBe(false); // 10 days
    expect(isStale("2026-07-07", asOf, 10)).toBe(true); // 11 days
  });
  it("treats absent/unparseable dates as stale (nothing fresh to trust)", () => {
    expect(isStale(null, asOf, 10)).toBe(true);
    expect(isStale(undefined, asOf, 10)).toBe(true);
    expect(isStale("not-a-date", asOf, 10)).toBe(true);
  });
  it("defaults to the product threshold", () => {
    expect(PRICE_STALE_DAYS).toBe(10);
    expect(isStale("2026-07-01", asOf)).toBe(true);
  });
});

describe("latestSessionDate", () => {
  it("finds the max date regardless of order; null when empty", () => {
    expect(
      latestSessionDate([
        { date: "2026-07-01", close: 1 },
        { date: "2026-07-10", close: 2 },
        { date: "2026-07-05", close: 3 },
      ]),
    ).toBe("2026-07-10");
    expect(latestSessionDate([])).toBeNull();
  });
});

describe("dailyPriceUniverse", () => {
  it("unions broad with the seed universe, deduped, and includes GLD", () => {
    // NEM is both an index member (broad) and a metals seed name.
    const broad = [
      { ticker: "NEM", exchange: "NYSE" },
      { ticker: "AAPL", exchange: "NASDAQ" },
    ];
    const out = dailyPriceUniverse(broad);
    const keys = out.map((s) => `${s.ticker}::${s.exchange}`);
    // Overlap collapsed to one entry.
    expect(keys.filter((k) => k === "NEM::NYSE")).toHaveLength(1);
    // The GLD benchmark (a metals seed row) is now covered by the daily job.
    expect(keys).toContain("GLD::NYSE");
    // No duplicate keys at all.
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("covers desk names even before the broad market is seeded", () => {
    const out = dailyPriceUniverse([]);
    expect(out.length).toBe(allSeedSecurities().length);
    expect(out.map((s) => `${s.ticker}::${s.exchange}`)).toContain("GLD::NYSE");
  });
});

describe("fundamentalsUniverse", () => {
  it("is exactly the dividend + metals names — never geopolitical/energy or ETFs", () => {
    const uni = fundamentalsUniverse();
    const keys = new Set(uni.map((s) => `${s.ticker}::${s.exchange}`));
    const tagOf = new Map(
      allSeedSecurities().map((s) => [`${s.ticker}::${s.exchange}`, s.tags ?? []]),
    );
    // Every included name carries a fundamentals-consuming tag.
    for (const key of keys) {
      const tags = tagOf.get(key) ?? [];
      expect(
        tags.includes("high_yield_watchlist") ||
          tags.includes("metals_buyhold_avoid"),
      ).toBe(true);
    }
    // A geopolitical-only name (LMT) and an ETF (GLD — no fundamentals) are out.
    expect(keys.has("LMT::NYSE")).toBe(false);
    expect(keys.has("GLD::NYSE")).toBe(false);
    // A metals producer (NEM) is in.
    expect(keys.has("NEM::NYSE")).toBe(true);
    expect(uni.length).toBeGreaterThan(0);
  });
});
