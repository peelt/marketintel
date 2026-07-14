/**
 * Pure price-reaction metrics — no I/O. All functions take a security's
 * daily closes ordered oldest → newest (trading sessions, gaps already
 * absent) and return `null` when the series can't support the computation.
 */

export interface SessionRow {
  date: string; // YYYY-MM-DD
  close: number;
  volume?: number | null;
}

/** Return over the last `sessions` TRADING sessions: last vs close n-back. */
export function returnOverSessions(
  series: SessionRow[],
  sessions: number,
): number | null {
  if (series.length < sessions + 1) return null;
  const last = series[series.length - 1].close;
  const base = series[series.length - 1 - sessions].close;
  if (base <= 0) return null;
  return last / base - 1;
}

/**
 * Volume spike: mean volume over the last 5 sessions vs the mean over the 30
 * sessions before that. >1 = elevated. Null when volume data is too sparse.
 */
export function volumeSpike(series: SessionRow[]): number | null {
  if (series.length < 20) return null;
  const volumes = series
    .map((s) => s.volume)
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (volumes.length < 15) return null;

  const recent = volumes.slice(-5);
  const baseline = volumes.slice(-35, -5);
  if (recent.length < 3 || baseline.length < 10) return null;

  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const base = mean(baseline);
  if (base <= 0) return null;
  return mean(recent) / base;
}

/** Fractional discount to the highest close in the series (≈52w when fed a year). */
export function discountToHigh(series: SessionRow[]): number | null {
  if (series.length < 30) return null;
  const last = series[series.length - 1].close;
  const high = Math.max(...series.map((s) => s.close));
  if (high <= 0) return null;
  return 1 - last / high;
}

export interface DropStats {
  return1d: number | null;
  return5d: number | null;
}

export function dropStats(series: SessionRow[]): DropStats {
  return {
    return1d: returnOverSessions(series, 1),
    return5d: returnOverSessions(series, 5),
  };
}

export interface InclusionThresholds {
  /** Include when the 5-session decline is at least this % (positive number). */
  drawdown5dPct: number;
  /** Or when the 1-session decline is at least this %. */
  drop1dPct: number;
}

/** Settled defaults (plan §5) — used only if framework params are absent/invalid. */
export const DEFAULT_THRESHOLDS: InclusionThresholds = {
  drawdown5dPct: 12,
  drop1dPct: 8,
};

/** Read inclusion thresholds out of framework params, defaulting safely. */
export function thresholdsFromParams(
  params: Record<string, unknown>,
): InclusionThresholds {
  const inclusion = (params as { inclusion?: Record<string, unknown> }).inclusion;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    drawdown5dPct: num(inclusion?.drawdown5dPct, DEFAULT_THRESHOLDS.drawdown5dPct),
    drop1dPct: num(inclusion?.drop1dPct, DEFAULT_THRESHOLDS.drop1dPct),
  };
}

/** The screen: does this name's move clear the inclusion bar? */
export function passesDropScreen(
  stats: DropStats,
  thresholds: InclusionThresholds,
): boolean {
  const fell5d =
    stats.return5d !== null && stats.return5d <= -thresholds.drawdown5dPct / 100;
  const fell1d =
    stats.return1d !== null && stats.return1d <= -thresholds.drop1dPct / 100;
  return fell5d || fell1d;
}

/**
 * Severity used ONLY to rank screened names when capping a large cohort —
 * the worst 5-session move, falling back to the 1-day move.
 */
export function dropSeverity(stats: DropStats): number {
  return Math.min(stats.return5d ?? 0, stats.return1d ?? 0);
}

/** Median helper (screen-relative excess decline). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
