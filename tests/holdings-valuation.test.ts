import { describe, expect, it } from "vitest";
import {
  convert,
  majorUnit,
  portfolioTotals,
  requiredRatePairs,
  valueHolding,
  type HoldingValuation,
} from "@/lib/holdings/valuation";

const NO_RATES = new Map<string, number>();
const USD_GBP = new Map<string, number>([["USD->GBP", 0.8]]);

describe("majorUnit", () => {
  it("divides LSE pence (GBp/GBX) by 100 and relabels to GBP", () => {
    expect(majorUnit(700, "GBp")).toEqual({ price: 7, currency: "GBP" });
    expect(majorUnit(700, "GBX")).toEqual({ price: 7, currency: "GBP" });
  });
  it("passes major-unit currencies through untouched", () => {
    expect(majorUnit(150, "USD")).toEqual({ price: 150, currency: "USD" });
    expect(majorUnit(150, null)).toEqual({ price: 150, currency: "USD" });
  });
});

describe("convert", () => {
  it("is identity for same currency, no rate needed", () => {
    expect(convert(100, "GBP", "GBP", NO_RATES)).toBe(100);
  });
  it("applies a supplied rate", () => {
    expect(convert(100, "USD", "GBP", USD_GBP)).toBe(80);
  });
  it("returns null for a missing rate — never guesses identity or zero", () => {
    expect(convert(100, "USD", "GBP", NO_RATES)).toBeNull();
  });
});

describe("valueHolding", () => {
  it("values a UK holding correctly — the pence trap (700p × 100 = £700, not £70,000)", () => {
    const v = valueHolding(
      { quantity: 100, latestClose: 700, priceCurrency: "GBp" },
      "GBP",
      NO_RATES,
    );
    expect(v.nativeValue).toBe(700);
    expect(v.nativeCurrency).toBe("GBP");
    expect(v.baseValue).toBe(700);
    expect(v.fxMissing).toBe(false);
  });

  it("converts a US holding into a GBP base with the FX rate", () => {
    const v = valueHolding(
      { quantity: 10, latestClose: 150, priceCurrency: "USD" },
      "GBP",
      USD_GBP,
    );
    expect(v.nativeValue).toBe(1500);
    expect(v.baseValue).toBe(1200); // 1500 × 0.8
  });

  it("flags fxMissing and leaves baseValue null when no rate is available", () => {
    const v = valueHolding(
      { quantity: 10, latestClose: 150, priceCurrency: "USD" },
      "GBP",
      NO_RATES,
    );
    expect(v.nativeValue).toBe(1500);
    expect(v.baseValue).toBeNull();
    expect(v.fxMissing).toBe(true);
  });

  it("returns all-null (never zero) when the holding has no price yet", () => {
    const v = valueHolding(
      { quantity: 10, latestClose: null, priceCurrency: null },
      "GBP",
      NO_RATES,
    );
    expect(v.nativeValue).toBeNull();
    expect(v.baseValue).toBeNull();
    expect(v.simpleReturn).toBeNull();
    expect(v.fxMissing).toBe(false);
  });

  it("computes P/L and simple return only with a cost basis, in like units", () => {
    const v = valueHolding(
      {
        quantity: 10,
        latestClose: 150,
        priceCurrency: "USD",
        purchasePrice: 100,
        purchaseCurrency: "USD",
      },
      "USD",
      NO_RATES,
    );
    expect(v.simpleReturn).toBeCloseTo(0.5); // 150 vs 100
    expect(v.baseUnrealisedPnl).toBe(500); // (1500 − 1000)
  });

  it("leaves P/L null without a purchase price (blank, not zero)", () => {
    const v = valueHolding(
      { quantity: 10, latestClose: 150, priceCurrency: "USD" },
      "USD",
      NO_RATES,
    );
    expect(v.baseUnrealisedPnl).toBeNull();
    expect(v.simpleReturn).toBeNull();
  });

  it("computes day change from the previous close", () => {
    const v = valueHolding(
      {
        quantity: 10,
        latestClose: 150,
        previousClose: 140,
        priceCurrency: "USD",
      },
      "USD",
      NO_RATES,
    );
    expect(v.baseDayChange).toBe(100); // (150 − 140) × 10
  });
});

describe("portfolioTotals", () => {
  it("sums base values and counts the FX-missing holdings it had to skip", () => {
    const vals: HoldingValuation[] = [
      {
        nativeValue: 700,
        nativeCurrency: "GBP",
        baseValue: 700,
        baseDayChange: 10,
        baseUnrealisedPnl: 50,
        simpleReturn: 0.08,
        fxMissing: false,
      },
      {
        nativeValue: 1500,
        nativeCurrency: "USD",
        baseValue: null,
        baseDayChange: null,
        baseUnrealisedPnl: null,
        simpleReturn: 0.1,
        fxMissing: true,
      },
    ];
    const t = portfolioTotals(vals);
    expect(t.baseValue).toBe(700);
    expect(t.valuedCount).toBe(1);
    expect(t.fxMissingCount).toBe(1);
  });
});

describe("requiredRatePairs", () => {
  it("dedupes and skips identity pairs (GBp normalises to the GBP base)", () => {
    const pairs = requiredRatePairs(
      [
        { priceCurrency: "USD" },
        { priceCurrency: "USD" },
        { priceCurrency: "GBp" },
        { priceCurrency: "GBP" },
      ],
      "GBP",
    );
    expect(pairs).toEqual([{ from: "USD", to: "GBP" }]);
  });
});
