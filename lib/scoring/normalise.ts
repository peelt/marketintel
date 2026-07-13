/**
 * Normalisation utilities for the scoring engine.
 *
 * Raw signal values come in any scale — yield %, EV/EBITDA ratios, payout
 * ratios, momentum percentiles. We normalise across the candidate set so
 * sub-signal weights remain meaningful regardless of magnitude.
 *
 * Default: rank-percentile normalisation. Bounded 0–100, robust to outliers,
 * and easy to explain ("3rd of 12 candidates = 83 percentile"). Z-score is
 * available where the distribution actually has tails worth respecting (e.g.
 * dividend yields), but rank is the safer default.
 */

export type NormalisationMethod = "rank" | "zscore";

export function normaliseValues(
  values: (number | null)[],
  direction: "higher_better" | "lower_better",
  method: NormalisationMethod = "rank",
): (number | null)[] {
  if (method === "zscore") {
    return zscoreNormalise(values, direction);
  }
  return rankNormalise(values, direction);
}

function rankNormalise(
  values: (number | null)[],
  direction: "higher_better" | "lower_better",
): (number | null)[] {
  const indexed = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null);
  if (indexed.length === 0) return values.map(() => null);

  indexed.sort((a, b) =>
    direction === "higher_better" ? a.v - b.v : b.v - a.v,
  );

  const out: (number | null)[] = values.map(() => null);
  const n = indexed.length;
  indexed.forEach((entry, rank) => {
    // Percentile rank: 0 for worst, 100 for best.
    out[entry.i] = n === 1 ? 100 : (rank / (n - 1)) * 100;
  });
  return out;
}

function zscoreNormalise(
  values: (number | null)[],
  direction: "higher_better" | "lower_better",
): (number | null)[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return values.map(() => null);
  const mean = present.reduce((s, v) => s + v, 0) / present.length;
  const variance =
    present.reduce((s, v) => s + (v - mean) ** 2, 0) / present.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return values.map((v) => (v === null ? null : 50));

  return values.map((v) => {
    if (v === null) return null;
    const z = (v - mean) / sd;
    // Map z ∈ [-3, +3] to [0, 100], clamp outside.
    const signed = direction === "higher_better" ? z : -z;
    const scaled = ((signed + 3) / 6) * 100;
    return Math.max(0, Math.min(100, scaled));
  });
}
