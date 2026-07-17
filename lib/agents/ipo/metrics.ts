import type { CandidateScore } from "@/lib/scoring/types";

/**
 * Pure IPO-desk classification — no I/O, fully unit-testable.
 *
 * Labels derive from ABSOLUTE facts (the metals lesson, plan §5): each
 * threshold reads a single calibrated grade the evaluation actually
 * produced, and the verdict names the grades it used. The composite ranks;
 * it never labels. Language is issuer-scoped and factual (I2) — the filing's
 * profile is described, the reader is never advised.
 */

export const MIN_COVERAGE_TO_CLASSIFY = 0.35;

// Weak on any single disqualifying fact:
const BUSINESS_WEAK = 40; // below this, the disclosed business doesn't hold up
const RISK_SEVERE = 35; // below this, the risk factors read existential
const GOVERNANCE_POOR = 30; // below this, holders have little say or sight

// Strong only when every dimension clears its own bar:
const BUSINESS_STRONG = 70;
const GROWTH_STRONG = 60;
const RISK_MANAGEABLE = 55;
const GOVERNANCE_ACCEPTABLE = 50;

export type IpoClassification =
  | "strong_profile"
  | "mixed_profile"
  | "weak_profile"
  | "shell_or_blank_check"
  | "insufficient_data";

function raw(scored: CandidateScore, criterion: string, signal: string): number | null {
  return scored.criteria[criterion]?.signals?.[signal]?.raw ?? null;
}

export function classifyIpo(
  scored: CandidateScore,
  facts: { isShellOrSpac: boolean },
): { verdict: string; classification: IpoClassification } {
  if (scored.coverage < MIN_COVERAGE_TO_CLASSIFY) {
    return {
      classification: "insufficient_data",
      verdict: `Only ${Math.round(scored.coverage * 100)}% of framework weight had data — classification withheld rather than guessed.`,
    };
  }

  const business = raw(scored, "business_quality", "business_quality_grade");
  const growth = raw(scored, "growth_prospects", "growth_grade");
  const risk = raw(scored, "risk_profile", "risk_grade");
  const governance = raw(scored, "governance", "governance_grade");

  // The evaluation is the desk's defining evidence: no grades, no label.
  if (business === null) {
    return {
      classification: "insufficient_data",
      verdict:
        "The prospectus evaluation did not complete this run — the profile is withheld rather than guessed.",
    };
  }

  if (facts.isShellOrSpac) {
    return {
      classification: "shell_or_blank_check",
      verdict:
        "Blank-check or shell registrant — there is no operating business in the filing to evaluate, so it sits outside the operating-company ranking.",
    };
  }

  const g = (v: number | null) => (v === null ? "n/a" : `${Math.round(v)}/100`);

  if (
    business < BUSINESS_WEAK ||
    (risk !== null && risk < RISK_SEVERE) ||
    (governance !== null && governance < GOVERNANCE_POOR)
  ) {
    const reasons: string[] = [];
    if (business < BUSINESS_WEAK) {
      reasons.push(`business quality graded ${g(business)} from the disclosed model`);
    }
    if (risk !== null && risk < RISK_SEVERE) {
      reasons.push(`risk factors graded ${g(risk)} — material red flags disclosed`);
    }
    if (governance !== null && governance < GOVERNANCE_POOR) {
      reasons.push(`governance graded ${g(governance)}`);
    }
    const body = reasons.join("; ");
    return {
      classification: "weak_profile",
      verdict: `${body.charAt(0).toUpperCase()}${body.slice(1)}.`,
    };
  }

  if (
    business >= BUSINESS_STRONG &&
    growth !== null &&
    growth >= GROWTH_STRONG &&
    risk !== null &&
    risk >= RISK_MANAGEABLE &&
    (governance === null || governance >= GOVERNANCE_ACCEPTABLE)
  ) {
    return {
      classification: "strong_profile",
      verdict: `Business quality graded ${g(business)}, growth ${g(growth)} and risk ${g(risk)} from the prospectus${governance !== null ? `; governance ${g(governance)}` : ""}.`,
    };
  }

  return {
    classification: "mixed_profile",
    verdict: `Business quality graded ${g(business)}, growth ${g(growth)}, risk ${g(risk)}${governance !== null ? `, governance ${g(governance)}` : ""} — strengths and weaknesses offset in the filing.`,
  };
}
