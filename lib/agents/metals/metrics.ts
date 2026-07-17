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

export const MIN_COVERAGE_TO_CLASSIFY = 0.35;

/**
 * Classification thresholds — ABSOLUTE facts, not blended ranks.
 *
 * The v1 lesson (live, 17 Jul 2026): banding the classification on the
 * COMPOSITE let the 25% mean-reversion valuation criterion flip labels — a
 * premier low-cost miner trading near its 52-week high scored terribly on
 * "distance below high" and read "vulnerable", which overclaims something the
 * composite never measured. Worse, missing fundamentals redistributed weight
 * TOWARD the price signals, amplifying the error. Labels now derive only
 * from what they claim: the calibrated cost grade and hard balance-sheet
 * numbers. Valuation is factual context in the verdict, never the judgment.
 */
const COST_STRONG = 70; // absolute cost grade at/above which the position is strong
const COST_SOLID = 55; // below this, cash burn starts to matter
const COST_THIN = 40; // below this the margin is thin at current prices
const DEBT_STRETCHED = 3.5; // debt/EBITDA above this is stretched for a miner
const DEBT_COMFORT = 2.5; // at/below this the balance sheet supports "well positioned"

export type MetalsClassification =
  | "well_positioned"
  | "mixed"
  | "vulnerable"
  | "insufficient_data";

/**
 * Pure classification: coverage floor first, then absolute position facts.
 * Language is security-scoped and factual (I2) — the cost position is
 * described, the reader is never advised.
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

  const cost =
    scored.criteria["cost_position"]?.signals?.["aisc_margin_grade"]?.raw ?? null;
  const debt =
    scored.criteria["balance_sheet"]?.signals?.["debt_to_ebitda_ttm"]?.raw ?? null;
  const fcf =
    scored.criteria["balance_sheet"]?.signals?.["fcf_yield_ttm"]?.raw ?? null;
  const discount =
    scored.criteria["valuation_vs_history"]?.signals?.["discount_to_52w_high"]?.raw ??
    null;

  // The cost grade is the desk's defining evidence. Without it, price action
  // alone must not produce a position label.
  if (cost === null) {
    return {
      classification: "insufficient_data",
      verdict:
        "No current cost disclosure could be researched this run — the position is withheld rather than judged on price action alone.",
    };
  }

  // Factual valuation CONTEXT (never part of the judgment).
  const valuationNote =
    discount !== null
      ? ` Trades ${Math.round(discount * 100)}% below its trailing-year high.`
      : "";
  const debtNote = debt !== null ? `; debt ${debt.toFixed(1)}× EBITDA` : "";

  const debtStretched = debt !== null && debt > DEBT_STRETCHED;
  const burningCash = fcf !== null && fcf < 0;

  if (cost < COST_THIN || debtStretched || (burningCash && cost < COST_SOLID)) {
    const reasons: string[] = [];
    if (cost < COST_THIN) {
      reasons.push(
        `cost position graded ${Math.round(cost)}/100 — a thin margin at current metal prices`,
      );
    }
    if (debtStretched) reasons.push(`debt at ${debt!.toFixed(1)}× EBITDA`);
    if (burningCash && cost >= COST_THIN && cost < COST_SOLID) {
      reasons.push(
        `negative free cash flow against a mid-pack cost position (${Math.round(cost)}/100)`,
      );
    }
    const body = reasons.join("; ");
    return {
      classification: "vulnerable",
      verdict: `${body.charAt(0).toUpperCase()}${body.slice(1)}.${valuationNote}`,
    };
  }

  if (
    cost >= COST_STRONG &&
    !debtStretched &&
    !burningCash &&
    (debt === null || debt <= DEBT_COMFORT)
  ) {
    return {
      classification: "well_positioned",
      verdict: `Cost position graded ${Math.round(cost)}/100 at current metal prices${debtNote}.${valuationNote}`,
    };
  }

  return {
    classification: "mixed",
    verdict: `Cost position graded ${Math.round(cost)}/100 at current metal prices${debtNote} — strengths and weaknesses offset.${valuationNote}`,
  };
}
