import type { CandidateScore } from "@/lib/scoring/types";

/**
 * Pure Geopolitical-desk classification — no I/O, fully unit-testable.
 *
 * Labels derive from ABSOLUTE facts (the metals lesson), never the blended
 * composite: each threshold reads one calibrated grade the exposure research
 * produced, and the verdict names the grades it used. The composite only
 * ranks the league table. Language is company-scoped and factual (I2) — the
 * position is described, the reader is never advised.
 *
 * "Materiality" is the gate: a name geopolitics barely touches is `insulated`
 * regardless of its (near-neutral) positioning, so a low-exposure domestic
 * name is never mislabelled a beneficiary or a casualty.
 */

export const MIN_COVERAGE_TO_CLASSIFY = 0.35;

const MATERIAL = 40; // at/above this, geopolitics genuinely bears on the name
const LOW_MATERIALITY = 35; // below this, the name is essentially off-thesis
const POSITIONING_STRONG = 65; // clear beneficiary of the active backdrop
const POSITIONING_WEAK = 35; // structurally threatened by the active backdrop

export type GeopoliticalClassification =
  | "beneficiary"
  | "mixed"
  | "at_risk"
  | "insulated"
  | "insufficient_data";

function raw(scored: CandidateScore, criterion: string, signal: string): number | null {
  return scored.criteria[criterion]?.signals?.[signal]?.raw ?? null;
}

export function classifyGeopolitical(scored: CandidateScore): {
  verdict: string;
  classification: GeopoliticalClassification;
} {
  if (scored.coverage < MIN_COVERAGE_TO_CLASSIFY) {
    return {
      classification: "insufficient_data",
      verdict: `Only ${Math.round(scored.coverage * 100)}% of framework weight had data — classification withheld rather than guessed.`,
    };
  }

  const positioning = raw(scored, "positioning", "positioning_grade");
  const materiality = raw(scored, "materiality", "materiality_grade");
  const resilience = raw(scored, "resilience", "resilience_grade");

  // Positioning is the desk's defining evidence: without it, no label.
  if (positioning === null) {
    return {
      classification: "insufficient_data",
      verdict:
        "The exposure grading did not complete this run — the position is withheld rather than guessed.",
    };
  }

  const g = (v: number | null) => (v === null ? "n/a" : `${Math.round(v)}/100`);
  const resilienceNote = resilience !== null ? `; resilience ${g(resilience)}` : "";

  // Low materiality gates everything: geopolitics barely moves this name.
  if (materiality !== null && materiality < LOW_MATERIALITY) {
    return {
      classification: "insulated",
      verdict: `Geopolitics is a minor factor here (materiality ${g(materiality)}) — positioning ${g(positioning)}${resilienceNote}.`,
    };
  }

  const material = materiality !== null && materiality >= MATERIAL;

  if (material && positioning >= POSITIONING_STRONG) {
    return {
      classification: "beneficiary",
      verdict: `Positioned to benefit from the current backdrop: positioning ${g(positioning)} at materiality ${g(materiality)}${resilienceNote}.`,
    };
  }

  if (material && positioning <= POSITIONING_WEAK) {
    return {
      classification: "at_risk",
      verdict: `Structurally exposed to the current backdrop: positioning ${g(positioning)} at materiality ${g(materiality)}${resilienceNote}.`,
    };
  }

  return {
    classification: "mixed",
    verdict: `Offsetting exposures to the current backdrop: positioning ${g(positioning)}, materiality ${g(materiality)}${resilienceNote}.`,
  };
}
