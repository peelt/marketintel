import type { SessionRow } from "@/lib/agents/reaction/metrics";

/**
 * Verdict-scorecard arithmetic — pure, no I/O, unit-tested.
 *
 * The scorecard grades THE FRAMEWORK: for each classified reaction verdict,
 * did the security's price behave the way that band claims? Overshoot bands
 * claim the fall was excessive (positive follow-through), `underreaction`
 * claims the damage exceeds the fall (negative follow-through),
 * `proportionate` claims the market got it about right.
 *
 * All returns are measured as EXCESS over the broad-universe median across
 * the same window — a raw forward return would credit every band with any
 * market-wide bounce (the exact confound in the first live week: the
 * overshoot cohort was semis flagged into a Thursday risk-on rally).
 */

export const WINDOWS = [1, 5, 20] as const;
export type Window = (typeof WINDOWS)[number];

/**
 * Forward return over `sessions` TRADING sessions from the session at
 * `t0Date` (exclusive of days the security didn't print — holiday calendars
 * differ between LSE and US names). Null when t0 isn't in the series or the
 * window hasn't matured yet.
 */
export function forwardReturn(
  series: SessionRow[],
  t0Date: string,
  sessions: number,
): number | null {
  const i0 = series.findIndex((s) => s.date === t0Date);
  if (i0 < 0) return null;
  const target = series[i0 + sessions];
  if (!target) return null;
  const base = series[i0].close;
  if (base <= 0) return null;
  return target.close / base - 1;
}

/**
 * The session a run actually screened: the security's latest print on or
 * before the report date (LSE and US calendars differ, and a name can miss a
 * print). Null when the series has nothing at or before the date.
 */
export function latestSessionOnOrBefore(
  series: SessionRow[],
  isoDate: string,
): string | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= isoDate) return series[i].date;
  }
  return null;
}

/** Median (null on empty) — local copy to keep this module dependency-free. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface OutcomeRow {
  classification: string;
  securityId: string;
  /** Raw forward returns (fractional) — null = window not matured. */
  r: Record<Window, number | null>;
  /** Universe median over the same windows — null = not computable. */
  universe: Record<Window, number | null>;
}

export interface BandSummary {
  classification: string;
  observations: number;
  uniqueNames: number;
  /** Median EXCESS return per window; null when no matured observations. */
  medianExcess: Record<Window, number | null>;
  /**
   * Share of matured observations that resolved in the band's own claimed
   * direction (overshoot → positive excess; underreaction → negative;
   * proportionate has no directional claim → null).
   */
  hitRate: Record<Window, number | null>;
  /** Observations whose window hasn't matured yet. */
  pending: Record<Window, number>;
}

/** Which sign does this band predict for excess forward returns? */
export function claimedDirection(
  classification: string,
): 1 | -1 | null {
  if (classification === "strong_overshoot" || classification === "mild_overshoot") {
    return 1;
  }
  if (classification === "underreaction") return -1;
  return null; // proportionate asserts "about right", not a direction
}

/** Bands that carry a priced claim — everything else is excluded up front. */
export const SCORED_BANDS = [
  "strong_overshoot",
  "mild_overshoot",
  "proportionate",
  "underreaction",
] as const;

/**
 * Aggregate outcome rows into per-band summaries. Repeat flags of the same
 * security are separate observations (they autocorrelate — a three-day flag
 * streak is closer to one episode than three independent calls), so unique
 * names are reported alongside n and the UI shows both.
 */
export function summariseBands(rows: OutcomeRow[]): BandSummary[] {
  return SCORED_BANDS.map((band) => {
    const items = rows.filter((r) => r.classification === band);
    const direction = claimedDirection(band);
    const medianExcess = {} as Record<Window, number | null>;
    const hitRate = {} as Record<Window, number | null>;
    const pending = {} as Record<Window, number>;

    for (const w of WINDOWS) {
      const matured = items.filter(
        (i) => i.r[w] !== null && i.universe[w] !== null,
      );
      pending[w] = items.length - matured.length;
      const excesses = matured.map((i) => i.r[w]! - i.universe[w]!);
      medianExcess[w] = medianOf(excesses);
      hitRate[w] =
        direction === null || excesses.length === 0
          ? null
          : excesses.filter((e) => (direction === 1 ? e > 0 : e < 0)).length /
            excesses.length;
    }

    return {
      classification: band,
      observations: items.length,
      uniqueNames: new Set(items.map((i) => i.securityId)).size,
      medianExcess,
      hitRate,
      pending,
    };
  });
}
