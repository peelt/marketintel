/**
 * Portfolio valuation — pure arithmetic, no I/O, fully unit-testable.
 *
 * Two currency hazards this module exists to handle:
 *
 *  1. LSE prices arrive in PENCE ("GBp"/"GBX"), not pounds. Valuing a UK
 *     holding without dividing by 100 is a silent 100× error. `majorUnit`
 *     normalises price + currency to the major unit before anything else.
 *  2. A portfolio mixes currencies (US + UK names). Values are converted to
 *     the portfolio base currency via a supplied rate map. A MISSING rate is
 *     null, never 0 or an identity guess (missing ≠ zero) — the caller shows
 *     the native value and flags the gap rather than fabricating a total.
 *
 * Nothing here is judgment: every number is factual arithmetic (I2). Purchase
 * price feeds P/L display only, never scoring.
 */

/** Price + reporting currency after pence→pounds normalisation. */
export interface MajorUnitPrice {
  price: number;
  currency: string;
}

/** Convert a raw provider price to its major unit. GBp/GBX pence → GBP pounds. */
export function majorUnit(price: number, currency: string | null): MajorUnitPrice {
  const c = (currency ?? "USD").trim();
  if (c === "GBp" || c === "GBX" || c === "GBX ") {
    return { price: price / 100, currency: "GBP" };
  }
  return { price, currency: c.toUpperCase() };
}

/** Uppercased "FROM->TO" rate key. Identity pairs resolve to 1 without a lookup. */
export function rateKey(from: string, to: string): string {
  return `${from.toUpperCase()}->${to.toUpperCase()}`;
}

/**
 * Convert `amount` from `from` currency to `to` using `rates` (keyed by
 * rateKey). Same currency → identity. Missing rate → null (caller decides how
 * to present the gap; never invents a number).
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: Map<string, number>,
): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return amount;
  const rate = rates.get(rateKey(f, t));
  if (rate == null || !Number.isFinite(rate)) return null;
  return amount * rate;
}

export interface HoldingInput {
  quantity: number;
  /** Latest close in the provider's reported units, or null if no price yet. */
  latestClose: number | null;
  priceCurrency: string | null;
  /** Prior session close, for the day-change figure. */
  previousClose?: number | null;
  purchasePrice?: number | null;
  /** Currency the purchase price was entered in; defaults to the price currency. */
  purchaseCurrency?: string | null;
}

export interface HoldingValuation {
  /** Value in the security's own major-unit currency. Null when no price. */
  nativeValue: number | null;
  nativeCurrency: string | null;
  /** Value converted to the portfolio base currency. Null if no price OR no FX rate. */
  baseValue: number | null;
  /** Absolute day change in base currency. Null when either close is missing. */
  baseDayChange: number | null;
  /** Unrealised P/L in base currency vs cost basis. Null without a purchase price or FX. */
  baseUnrealisedPnl: number | null;
  /** Simple return fraction vs cost basis (0.1 = +10%). Null without a purchase price. */
  simpleReturn: number | null;
  /** True when a value could not be expressed in base currency for want of an FX rate. */
  fxMissing: boolean;
}

export function valueHolding(
  input: HoldingInput,
  baseCurrency: string,
  rates: Map<string, number>,
): HoldingValuation {
  const base = baseCurrency.toUpperCase();

  if (input.latestClose == null) {
    // No price at all — everything downstream is "no data", never zero.
    return {
      nativeValue: null,
      nativeCurrency: null,
      baseValue: null,
      baseDayChange: null,
      baseUnrealisedPnl: null,
      simpleReturn: null,
      fxMissing: false,
    };
  }

  const { price, currency } = majorUnit(input.latestClose, input.priceCurrency);
  const nativeValue = price * input.quantity;
  const baseValue = convert(nativeValue, currency, base, rates);
  const fxMissing = baseValue === null;

  // Day change: needs a prior close in the same units.
  let baseDayChange: number | null = null;
  if (input.previousClose != null) {
    const prev = majorUnit(input.previousClose, input.priceCurrency).price;
    const nativeChange = (price - prev) * input.quantity;
    baseDayChange = convert(nativeChange, currency, base, rates);
  }

  // Unrealised P/L + simple return: only with a cost basis.
  let baseUnrealisedPnl: number | null = null;
  let simpleReturn: number | null = null;
  if (input.purchasePrice != null && input.purchasePrice > 0) {
    const costCurrencyRaw = input.purchaseCurrency ?? input.priceCurrency;
    const cost = majorUnit(input.purchasePrice, costCurrencyRaw);
    const costBasisNative = cost.price * input.quantity;
    // Return is a ratio in like units — no FX needed, so it always resolves.
    // Compare current native value to cost in the SAME major-unit currency.
    if (cost.currency === currency) {
      simpleReturn = (nativeValue - costBasisNative) / costBasisNative;
    } else {
      // Cross-currency cost basis: convert cost into the price currency first.
      const costInPriceCcy = convert(costBasisNative, cost.currency, currency, rates);
      if (costInPriceCcy != null && costInPriceCcy > 0) {
        simpleReturn = (nativeValue - costInPriceCcy) / costInPriceCcy;
      }
    }
    const costInBase = convert(costBasisNative, cost.currency, base, rates);
    if (baseValue != null && costInBase != null) {
      baseUnrealisedPnl = baseValue - costInBase;
    }
  }

  return {
    nativeValue,
    nativeCurrency: currency,
    baseValue,
    baseDayChange,
    baseUnrealisedPnl,
    simpleReturn,
    fxMissing,
  };
}

/** Sum base-currency values, skipping holdings with no base value (no price / no FX). */
export function portfolioTotals(valuations: HoldingValuation[]): {
  baseValue: number;
  baseDayChange: number;
  baseUnrealisedPnl: number;
  valuedCount: number;
  fxMissingCount: number;
} {
  let baseValue = 0;
  let baseDayChange = 0;
  let baseUnrealisedPnl = 0;
  let valuedCount = 0;
  let fxMissingCount = 0;
  for (const v of valuations) {
    if (v.fxMissing) fxMissingCount++;
    if (v.baseValue != null) {
      baseValue += v.baseValue;
      valuedCount++;
    }
    if (v.baseDayChange != null) baseDayChange += v.baseDayChange;
    if (v.baseUnrealisedPnl != null) baseUnrealisedPnl += v.baseUnrealisedPnl;
  }
  return { baseValue, baseDayChange, baseUnrealisedPnl, valuedCount, fxMissingCount };
}

/** Currency pairs a set of holdings needs converted to `base` (for FX prefetch). */
export function requiredRatePairs(
  holdings: { priceCurrency: string | null }[],
  base: string,
): Array<{ from: string; to: string }> {
  const seen = new Set<string>();
  const pairs: Array<{ from: string; to: string }> = [];
  for (const h of holdings) {
    const from = majorUnit(1, h.priceCurrency).currency;
    const to = base.toUpperCase();
    if (from === to) continue;
    const key = rateKey(from, to);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ from, to });
  }
  return pairs;
}
