import type { SessionRow } from "@/lib/agents/reaction/metrics";

/**
 * Freshness backstop. Option A's scheduled refreshes keep the desk universes
 * current, but a refresh CAN fail (provider outage, rate cap). When it does,
 * a price-dependent signal should degrade honestly — return null so the
 * engine redistributes its weight and coverage drops (missing ≠ zero) —
 * rather than compute a confident number from a weeks-old close. This is the
 * "trust the data only if it's fresh" gate.
 *
 * The threshold must tolerate normal gaps (weekends, holidays: a Saturday
 * metals run legitimately reads Friday's close), so it's generous — it catches
 * genuinely stale data (a failed refresh leaving data weeks old), not the
 * routine 1–3 day lag.
 */

export const PRICE_STALE_DAYS = 10;

/** Latest as-of date in a price series (order-independent). Null if empty. */
export function latestSessionDate(series: SessionRow[]): string | null {
  let max: string | null = null;
  for (const r of series) if (max === null || r.date > max) max = r.date;
  return max;
}

/**
 * True when `latestDate` is more than `maxDays` before `asOf` — or absent.
 * Pure; both dates are YYYY-MM-DD. An unparseable/absent date reads as stale
 * (there is nothing fresh to trust).
 */
export function isStale(
  latestDate: string | null | undefined,
  asOf: string,
  maxDays: number = PRICE_STALE_DAYS,
): boolean {
  if (!latestDate) return true;
  const latest = Date.parse(latestDate);
  const ref = Date.parse(asOf);
  if (!Number.isFinite(latest) || !Number.isFinite(ref)) return true;
  return ref - latest > maxDays * 24 * 60 * 60 * 1000;
}
