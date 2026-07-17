import type { CandidateScore } from "@/lib/scoring/types";

/**
 * Pure Metals-desk helpers — no I/O, fully unit-testable. Missing ≠ zero
 * throughout: every function returns null when its inputs can't support the
 * computation, and the engine redistributes the weight.
 */

/** Relative 6-month strength vs the gold benchmark: rStock − rGold. */
export function rsVsBenchmark(
  stockReturn: number | null,
  benchmarkReturn: number | null,
): number | null {
  if (stockReturn == null || benchmarkReturn == null) return null;
  return stockReturn - benchmarkReturn;
}

/** Free-cash-flow yield on market cap. */
export function fcfYield(
  freeCashFlow: number | null | undefined,
  marketCap: number | null | undefined,
): number | null {
  if (freeCashFlow == null || marketCap == null || marketCap <= 0) return null;
  return freeCashFlow / marketCap;
}

/** Verdict bands (composite is "position strength", higher = stronger). */
const WELL_POSITIONED_MIN = 65;
const MIXED_MIN = 45;
export const MIN_COVERAGE_TO_CLASSIFY = 0.35;

export type MetalsClassification =
  | "well_positioned"
  | "mixed"
  | "vulnerable"
  | "insufficient_data";

/**
 * Pure classification: coverage floor first (missing ≠ zero — a thin
 * composite is withheld, not classified), then position bands. Language is
 * security-scoped and factual (I2) — the cost position is described, the
 * reader is never advised.
 */
export function classifyMetals(scored: CandidateScore): {
  verdict: string;
  classification: MetalsClassification;
} {
  if (scored.coverage < MIN_COVERAGE_TO_CLASSIFY) {
    return {
      classification: "insufficient_data",
      verdict: `Only ${Math.round(scored.coverage * 100)}% of framework weight had data — classification withheld rather than guessed.`,
    };
  }

  const costGrade =
    scored.criteria["cost_position"]?.signals?.["aisc_margin_grade"]?.raw ?? null;
  const costNote =
    costGrade != null
      ? ` Cost position graded ${Math.round(costGrade)}/100 at current metal prices.`
      : " No current cost disclosure was found this run — the grade leans on balance sheet and valuation signals.";

  if (scored.composite >= WELL_POSITIONED_MIN) {
    return {
      classification: "well_positioned",
      verdict: `The framework scores the producer in the strongest band of this screen.${costNote}`,
    };
  }
  if (scored.composite >= MIXED_MIN) {
    return {
      classification: "mixed",
      verdict: `The framework scores the position as mixed — strengths and weaknesses offset.${costNote}`,
    };
  }
  return {
    classification: "vulnerable",
    verdict: `The framework scores the position in the weakest band of this screen.${costNote}`,
  };
}
