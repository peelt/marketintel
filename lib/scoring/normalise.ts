/**
 * Normalisation utilities for the scoring engine.
 *
 * Raw signal values come in any scale — yield %, EV/EBITDA ratios, payout
 * ratios, momentum percentiles. Three modes, selected per sub-signal in the
 * framework (see ScoringCriterion.subSignals[].normalisation):
 *
 *   rank     — percentile across the candidate set. Bounded 0–100, robust to
 *              outliers, easy to explain — but RELATIVE: composites are
 *              rankings within one report, not comparable across reports.
 *   zscore   — z-score across the set mapped to 0–100. Still relative.
 *   absolute — passthrough: the raw value already IS a calibrated 0–100 score
 *              (LLM grades, absolute-threshold signals). Clamped; inverted
 *              for lower_better. This is what makes scores comparable across
 *              reports and over time.
 */

export type NormalisationMethod = "rank" | "zscore" | "absolute";

export function normaliseValues(
  values: (number | null)[],
  direction: "higher_better" | "lower_better",
  method: NormalisationMethod = "rank",
): (number | null)[] {
  switch (method) {
    case "zscore":
      return zscoreNormalise(values, direction);
    case "absolute":
      return absoluteNormalise(values, direction);
    default:
      return rankNormalise(values, direction);
  }
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

/**
 * Passthrough for values that are already calibrated 0–100 scores. No
 * cross-candidate re-ranking — a field where every candidate is weak stays
 * weak. `lower_better` inverts (e.g. a 0–100 risk score where low is good).
 */
function absoluteNormalise(
  values: (number | null)[],
  direction: "higher_better" | "lower_better",
): (number | null)[] {
  return values.map((v) => {
    if (v === null) return null;
    const clamped = Math.max(0, Math.min(100, v));
    return direction === "higher_better" ? clamped : 100 - clamped;
  });
}
