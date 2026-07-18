import type { EvidenceItem } from "@/lib/agents/types";
import type { SignalResolverRegistry, SignalValue } from "@/lib/scoring/types";
import { confidenceWeight, type GeoExposureGrade } from "./research";

/**
 * Geopolitical signal resolvers. No per-signal I/O: the expensive work (the
 * macro read and one exposure grade per name) already happened in
 * collectCandidates, so resolution is a pure read of the grade the run
 * context carries. Each of the three calibrated absolute grades becomes one
 * sub-signal, with the exposure research attached as evidence.
 */

export interface GeoCandidate {
  securityId: string;
  ticker: string;
  name: string;
  grade: GeoExposureGrade | null;
}

export interface GeoRunContext {
  candidates: Map<string, GeoCandidate>;
  asOf: string;
}

const NO_DATA: SignalValue = { raw: null, evidence: [] };

type GradeKey = keyof Pick<
  GeoExposureGrade,
  "positioningGrade" | "resilienceGrade" | "materialityGrade"
>;

const SIGNAL_MAP: Record<string, { key: GradeKey; label: string }> = {
  "geopolitical.positioning_grade": { key: "positioningGrade", label: "positioning" },
  "geopolitical.resilience_grade": { key: "resilienceGrade", label: "resilience" },
  "geopolitical.materiality_grade": { key: "materialityGrade", label: "materiality" },
};

export function createGeopoliticalResolver(ctx: GeoRunContext): SignalResolverRegistry {
  async function resolveBatch(params: {
    securityIds: string[];
    sourceQuery: string;
  }): Promise<Map<string, SignalValue>> {
    const { securityIds, sourceQuery } = params;
    const out = new Map<string, SignalValue>();
    const signal = SIGNAL_MAP[sourceQuery];

    for (const id of securityIds) {
      const candidate = ctx.candidates.get(id);
      const grade = candidate?.grade;
      if (!signal || !candidate || !grade) {
        out.set(id, NO_DATA);
        continue;
      }
      // The positioning signal carries the full research card (the desk's
      // anchor evidence); the other two carry a compact grade note.
      const evidence =
        sourceQuery === "geopolitical.positioning_grade"
          ? exposureCard(candidate, grade)
          : gradeNote(candidate, grade, signal.label, signal.key);
      out.set(id, { raw: grade[signal.key], evidence: [evidence] });
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
 * Anchor evidence card — same persisted SHAPE as the Reaction/Metals research
 * rows so the report page renders the designed card (badges, paragraphs)
 * instead of a wall of text, with the desk's own grade label.
 */
function exposureCard(candidate: GeoCandidate, grade: GeoExposureGrade): EvidenceItem {
  return {
    type: "macro_indicator",
    sourceTable: "web_search",
    sourceId: "",
    text: `[${candidate.ticker} · positioning ${grade.positioningGrade}/100 · ${grade.confidence}] ${grade.headline}\n\n${grade.summary}\n\nPrimary theme: ${grade.primaryTheme}`,
    weight: confidenceWeight(grade.confidence),
    securityId: candidate.securityId,
  };
}

function gradeNote(
  candidate: GeoCandidate,
  grade: GeoExposureGrade,
  label: string,
  key: GradeKey,
): EvidenceItem {
  return {
    type: "derived_metric",
    sourceTable: "derived",
    sourceId: "",
    text: `${candidate.ticker}: ${label} graded ${grade[key]}/100 against the current backdrop (primary theme: ${grade.primaryTheme})`,
    weight: confidenceWeight(grade.confidence),
    securityId: candidate.securityId,
  };
}
