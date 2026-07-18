import type { EvidenceItem } from "@/lib/agents/types";
import type { SignalResolverRegistry, SignalValue } from "@/lib/scoring/types";
import { isPlaceholderTicker } from "@/lib/format";
import { confidenceWeight, type IpoEval } from "./research";

/**
 * IPO signal resolvers. Unlike the other desks there is no per-signal I/O
 * here: the expensive work (discovery, document fetch, one evaluation per
 * issuer) already happened in collectCandidates, so resolution is a pure
 * read of the evaluation the run context carries. Every signal is one of the
 * evaluation's calibrated absolute grades, each with its own prospectus-
 * grounded rationale as evidence.
 */

export interface IpoCandidate {
  securityId: string;
  cik: string;
  ticker: string;
  name: string;
  filingType: string;
  filedAt: string; // ISO
  accession: string;
  /** Filing index page on EDGAR — always resolvable, links to every doc. */
  filingUrl: string;
  eval: IpoEval | null;
}

export interface IpoRunContext {
  candidates: Map<string, IpoCandidate>;
  /** Issuers whose prospectus couldn't be read this run (still reported). */
  unreadable: string[];
  asOf: string;
}

const NO_DATA: SignalValue = { raw: null, evidence: [] };

type GradeKey = {
  grade: keyof Pick<
    IpoEval,
    | "businessQualityGrade"
    | "growthGrade"
    | "riskGrade"
    | "governanceGrade"
    | "offeringTermsGrade"
  >;
  note: keyof Pick<
    IpoEval,
    | "businessQualityNote"
    | "growthNote"
    | "riskNote"
    | "governanceNote"
    | "offeringTermsNote"
  >;
  label: string;
};

const SIGNAL_MAP: Record<string, GradeKey> = {
  "ipo.business_quality_grade": {
    grade: "businessQualityGrade",
    note: "businessQualityNote",
    label: "business quality",
  },
  "ipo.growth_grade": { grade: "growthGrade", note: "growthNote", label: "growth" },
  "ipo.risk_grade": { grade: "riskGrade", note: "riskNote", label: "risk profile" },
  "ipo.governance_grade": {
    grade: "governanceGrade",
    note: "governanceNote",
    label: "governance",
  },
  "ipo.offering_terms_grade": {
    grade: "offeringTermsGrade",
    note: "offeringTermsNote",
    label: "offering terms",
  },
};

export function createIpoResolver(ctx: IpoRunContext): SignalResolverRegistry {
  async function resolveBatch(params: {
    securityIds: string[];
    sourceQuery: string;
  }): Promise<Map<string, SignalValue>> {
    const { securityIds, sourceQuery } = params;
    const out = new Map<string, SignalValue>();
    const signal = SIGNAL_MAP[sourceQuery];

    for (const id of securityIds) {
      const candidate = ctx.candidates.get(id);
      const evaluation = candidate?.eval;
      if (!signal || !candidate || !evaluation) {
        out.set(id, NO_DATA);
        continue;
      }
      const grade = evaluation[signal.grade];
      const evidence =
        sourceQuery === "ipo.business_quality_grade"
          ? evalCard(candidate, evaluation)
          : gradeNote(candidate, evaluation, signal);
      out.set(id, { raw: grade, evidence: [evidence] });
    }
    return out;
  }

  return {
    resolve: async ({ securityId, sourceQuery }) => {
      const batch = await resolveBatch({ securityIds: [securityId], sourceQuery });
      return batch.get(securityId) ?? NO_DATA;
    },
    resolveBatch,
  };
}

/**
 * The anchor evidence card — same persisted SHAPE as the Reaction/Metals
 * research rows so the report page renders the designed card (badges,
 * paragraphs, a real link to the filing) instead of a wall of text.
 */
/** Evidence-text label: the name while the ticker is still a CIK placeholder. */
function evidenceLabel(candidate: IpoCandidate): string {
  return isPlaceholderTicker(candidate.ticker)
    ? candidate.name
    : candidate.ticker;
}

function evalCard(candidate: IpoCandidate, evaluation: IpoEval): EvidenceItem {
  const filedDate = candidate.filedAt.slice(0, 10);
  return {
    type: "filing_section",
    sourceTable: "sec_edgar",
    sourceId: candidate.accession,
    text: `[${evidenceLabel(candidate)} · business quality ${evaluation.businessQualityGrade}/100 · ${evaluation.confidence}] ${evaluation.headline}\n\n${evaluation.summary}\n\n${evaluation.businessQualityNote}\n\nSources:\n${candidate.filingType} filing (${filedDate}) — ${candidate.filingUrl}`,
    weight: confidenceWeight(evaluation.confidence),
    securityId: candidate.securityId,
  };
}

function gradeNote(
  candidate: IpoCandidate,
  evaluation: IpoEval,
  signal: GradeKey,
): EvidenceItem {
  return {
    type: "filing_section",
    sourceTable: "sec_edgar",
    sourceId: candidate.accession,
    text: `${evidenceLabel(candidate)}: ${signal.label} graded ${evaluation[signal.grade]}/100 from the prospectus — ${evaluation[signal.note]}`,
    weight: confidenceWeight(evaluation.confidence),
    securityId: candidate.securityId,
  };
}
