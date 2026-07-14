/**
 * Pure dividend metrics — no I/O, fully unit-testable.
 *
 * Every function returns `null` (never 0) when the inputs can't support the
 * computation: missing ≠ zero is a §1 invariant, and the scoring engine
 * treats null as "redistribute this signal's weight", not "worst".
 *
 * Currency note: yields and cover ratios divide like-by-like (GBp dividends
 * over GBp prices, native-currency FCF over native-currency payout), so
 * units cancel and no FX conversion is needed here. Anything cross-currency
 * belongs in a resolver, not in these primitives.
 */

export interface DividendPayment {
  exDate: string; // YYYY-MM-DD
  amount: number;
}

/** Sum of per-share dividends with ex-dates in the trailing 365 days. */
export function ttmDividendPerShare(
  payments: DividendPayment[],
  asOf: string,
): number | null {
  const end = Date.parse(asOf);
  const start = end - 365 * 24 * 60 * 60 * 1000;
  const inWindow = payments.filter((p) => {
    const t = Date.parse(p.exDate);
    return t > start && t <= end;
  });
  if (inWindow.length === 0) return null;
  return inWindow.reduce((s, p) => s + p.amount, 0);
}

/** Trailing yield = TTM dividends per share / price, same currency units. */
export function trailingYield(
  ttmDps: number | null,
  price: number | null,
): number | null {
  if (ttmDps == null || price == null || price <= 0) return null;
  return ttmDps / price;
}

/**
 * Calendar-year dividend totals, oldest → newest, ONLY complete years (the
 * current partial year would read as a phantom cut). Years with no payments
 * inside the observed span count as 0 — a genuine gap, not missing data.
 */
export function annualDividendSeries(
  payments: DividendPayment[],
  asOf: string,
): { year: number; total: number }[] {
  if (payments.length === 0) return [];
  const currentYear = new Date(asOf).getUTCFullYear();
  const byYear = new Map<number, number>();
  let firstYear = Infinity;
  for (const p of payments) {
    const year = new Date(p.exDate).getUTCFullYear();
    if (year >= currentYear) continue; // partial year — exclude
    byYear.set(year, (byYear.get(year) ?? 0) + p.amount);
    if (year < firstYear) firstYear = year;
  }
  if (!Number.isFinite(firstYear)) return [];
  const out: { year: number; total: number }[] = [];
  for (let y = firstYear; y < currentYear; y++) {
    out.push({ year: y, total: byYear.get(y) ?? 0 });
  }
  return out;
}

/**
 * CAGR of annual dividends across up to `years` complete years. Needs at
 * least two complete years; returns null otherwise. A start-year total of 0
 * makes CAGR undefined — null, not Infinity.
 */
export function dividendGrowthCagr(
  series: { year: number; total: number }[],
  years = 5,
): number | null {
  const window = series.slice(-years);
  if (window.length < 2) return null;
  const first = window[0].total;
  const last = window[window.length - 1].total;
  if (first <= 0 || last <= 0) return null;
  const span = window.length - 1;
  return Math.pow(last / first, 1 / span) - 1;
}

/**
 * Consecutive complete years, counting back from the most recent, in which
 * the annual total did not fall more than `tolerance` below the prior year
 * (small declines are usually FX/rounding noise, not cuts). A genuine cut
 * stops the count.
 */
export function yearsWithoutCut(
  series: { year: number; total: number }[],
  tolerance = 0.02,
): number | null {
  if (series.length < 2) return null;
  let count = 0;
  for (let i = series.length - 1; i >= 1; i--) {
    const prev = series[i - 1].total;
    const curr = series[i].total;
    if (prev <= 0) break;
    if (curr < prev * (1 - tolerance)) break;
    count++;
  }
  return count;
}

/**
 * Z-score of the latest value against a history INCLUDING it. Positive =
 * above its own recent norm. For yields, a strongly positive z-score means
 * the market has repriced the stock down relative to its payout — the
 * classic pre-cut signature (which is why the framework scores it
 * lower_better, never as a buy signal).
 */
export function zScore(history: number[]): number | null {
  if (history.length < 8) return null; // too few points to define a norm
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const variance =
    history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (history[history.length - 1] - mean) / sd;
}

/** dividendsPaid is negative in cash-flow statements; normalise to outflow magnitude. */
export function payoutRatio(
  dividendsPaid: number | null | undefined,
  netIncome: number | null | undefined,
): number | null {
  if (dividendsPaid == null || netIncome == null || netIncome <= 0) return null;
  const paid = Math.abs(dividendsPaid);
  if (paid === 0) return null;
  return paid / netIncome;
}

export function fcfCover(
  freeCashFlow: number | null | undefined,
  dividendsPaid: number | null | undefined,
): number | null {
  if (freeCashFlow == null || dividendsPaid == null) return null;
  const paid = Math.abs(dividendsPaid);
  if (paid === 0) return null;
  return freeCashFlow / paid;
}

export function debtToEbitda(
  totalDebt: number | null | undefined,
  ebitda: number | null | undefined,
): number | null {
  if (totalDebt == null || ebitda == null || ebitda <= 0) return null;
  return totalDebt / ebitda;
}

/** Year-over-year fractional change; null when either side is unusable. */
export function yoyChange(
  current: number | null | undefined,
  prior: number | null | undefined,
): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return (current - prior) / Math.abs(prior);
}

/** Median of a non-empty list; null on empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
