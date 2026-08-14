/**
 * Which close did a filed verdict actually screen?
 *
 * The scorecard measures forward returns FROM that close. Resolving it as
 * "latest close on or before the report's timestamp" is wrong once a later
 * pass can land a fresher print: the 00:30 catch-up does exactly that, so a
 * verdict filed on the 12 Aug close was being measured from the 13 Aug close —
 * a start price that already contained part of the bounce the verdict
 * predicted (WDC: 454.10 screened vs 487.29 measured, +7.3%). That silently
 * flatters the track record, which is the one number that has to be honest.
 *
 * Three sources, in order of authority:
 *   1. `scoring_breakdown.screenedAt` — pinned at report time (current runs).
 *   2. The verdict's own "(as of the 12 Aug 2026 close)" stamp — covers rows
 *      filed since the stamp shipped, without a backfill.
 *   3. Null — caller falls back to the old rule and the row is marked as
 *      inferred rather than silently trusted.
 */

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** "(as of the 12 Aug 2026 close)" → "2026-08-12". Null when absent. */
export function parseScreenedStamp(verdict: string | null): string | null {
  if (!verdict) return null;
  const m = /\(as of the (\d{1,2}) ([A-Za-z]{3,}) (\d{4}) close\)/.exec(verdict);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  const year = Number(m[3]);
  if (month < 0 || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ScreenedDateResult {
  date: string | null;
  /** How it was determined — surfaced so inferred anchors stay visible. */
  source: "pinned" | "stamp" | "inferred";
}

/**
 * Resolve the screened close for one report item. Pure — unit-tested.
 * `fallback` is the old "latest close ≤ report date" answer.
 */
export function resolveScreenedDate(input: {
  breakdown: { screenedAt?: string | null } | null;
  verdict: string | null;
  fallback: string | null;
}): ScreenedDateResult {
  const pinned = input.breakdown?.screenedAt ?? null;
  if (pinned) return { date: pinned, source: "pinned" };
  const stamped = parseScreenedStamp(input.verdict);
  if (stamped) return { date: stamped, source: "stamp" };
  return { date: input.fallback, source: "inferred" };
}
