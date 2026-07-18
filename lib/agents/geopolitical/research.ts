import { getAnthropicClient, modelForTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";

/**
 * Per-name exposure grading for the Geopolitical desk. Given the run's
 * pre-researched macro themes, one routine-tier structured call per company
 * grades how it is POSITIONED for that backdrop — NO per-name web search (the
 * themes are already researched and passed in; a company's structural
 * exposures — revenue geography, supply chain, end-markets — are stable and
 * don't need fresh search), which keeps the whole ~40-name desk cheap.
 *
 * Three 0-100 ABSOLUTE grades so the framework consumes them with
 * normalisation: "absolute":
 *   positioning — higher = better positioned for the active backdrop
 *                 (a beneficiary), lower = structurally threatened by it.
 *   resilience  — higher = more insulated (diversified geography, hedged
 *                 supply chain, flexible sourcing).
 *   materiality — higher = geopolitics is more MATERIAL to this name at all
 *                 (a domestic utility is low; a chip exporter is high).
 *
 * Failure contract: null after one retry. Language discipline (I2): describes
 * the company's exposure, never a reader's holdings or any market call.
 */

export interface GeoExposureRequest {
  ticker: string;
  name: string;
  sector: string | null;
  subSector: string | null;
  /** Pre-researched macro themes block (from macro.ts). */
  themesBlock: string;
  asOf: string;
}

export interface GeoExposureGrade {
  positioningGrade: number; // 0-100 absolute (higher = better positioned)
  resilienceGrade: number; // 0-100 absolute (higher = more insulated)
  materialityGrade: number; // 0-100 absolute (higher = more exposed at all)
  /** The single theme this name is most tied to. */
  primaryTheme: string;
  headline: string;
  summary: string;
  confidence: "low" | "medium" | "high";
}

const EXPOSURE_SCHEMA = {
  type: "object",
  properties: {
    positioning_grade: {
      type: "integer",
      description:
        "0-100 ABSOLUTE, how well POSITIONED the company is for the current backdrop. 100 = a clear beneficiary of the active themes (e.g. domestic defense in a rearmament cycle); 50 = net-neutral or offsetting exposures; 0 = structurally threatened by the active themes (e.g. reliant on a targeted supply chain or sanctioned market).",
    },
    resilience_grade: {
      type: "integer",
      description:
        "0-100 ABSOLUTE resilience: geographic revenue diversification, supply-chain flexibility, ability to re-source or pass through costs. 100 = highly insulated; 0 = single-point dependence with no alternative.",
    },
    materiality_grade: {
      type: "integer",
      description:
        "0-100 ABSOLUTE: how MATERIAL geopolitics is to this company AT ALL, regardless of direction. 100 = geopolitics is a first-order driver of the business; 0 = essentially a domestic operation geopolitics barely touches. A low materiality name is not 'bad' — it is simply off-thesis for this desk.",
    },
    primary_theme: {
      type: "string",
      description:
        "The single macro theme (by its title) this company is MOST tied to.",
    },
    headline: {
      type: "string",
      description: "One sentence: the company's geopolitical position in plain terms.",
    },
    summary: {
      type: "string",
      description:
        "3-5 sentences: the specific exposures (which markets, which supply chains, which end-customers) and how the active themes bear on them. Impersonal — describe the company, never advise a reader.",
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "high only when the company's relevant exposures are well understood and clearly map to the themes; low when the link is speculative.",
    },
  },
  required: [
    "positioning_grade",
    "resilience_grade",
    "materiality_grade",
    "primary_theme",
    "headline",
    "summary",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a geopolitical-risk analyst grading how a company is positioned for the CURRENT geopolitical backdrop you are given.

Discipline:
- Grade only against the themes provided. Do not invent a backdrop.
- All grades are ABSOLUTE (calibrated across all companies and time), not relative to any list.
- Ground the summary in the company's actual, specific exposures — revenue geography, supply chain, key end-markets, regulatory targeting.
- "Positioning" is directional (beneficiary vs. threatened); "materiality" is direction-agnostic (how much geopolitics matters to the name at all). A low-materiality domestic name should get a low materiality grade and a near-neutral positioning grade.
- Describe the company. NEVER address a reader's holdings or decisions; no recommendations, price targets, or "buy/sell".`;

/** One retry on any failure path. */
export async function gradeGeoExposure(
  request: GeoExposureRequest,
): Promise<GeoExposureGrade | null> {
  const first = await attemptExposure(request);
  if (first) return first;
  console.warn(`gradeGeoExposure: retrying ${request.ticker} after empty result`);
  return attemptExposure(request);
}

async function attemptExposure(
  request: GeoExposureRequest,
): Promise<GeoExposureGrade | null> {
  const client = getAnthropicClient();
  const userPrompt = `Company: ${request.name} (${request.ticker})${request.sector ? `, ${request.sector}` : ""}${request.subSector ? ` / ${request.subSector}` : ""}.

Current geopolitical themes:
${request.themesBlock}

As of ${request.asOf}, grade this company's positioning, resilience and materiality against these themes per the discipline.`;

  try {
    const response = await client.messages.create({
      model: modelForTier("routine"),
      max_tokens: 8_000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: EXPOSURE_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      console.error(
        `gradeGeoExposure: unusable stop_reason=${response.stop_reason} for ${request.ticker}`,
      );
      return null;
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseGeoExposure(textBlock.text);
  } catch (err) {
    console.error(
      `gradeGeoExposure failed for ${request.ticker}: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

/** Defensive parse — exported for tests. */
export function parseGeoExposure(text: string): GeoExposureGrade | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    const inRange = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
    const isStr = (v: unknown): v is string => typeof v === "string";
    if (
      !inRange(c.positioning_grade) ||
      !inRange(c.resilience_grade) ||
      !inRange(c.materiality_grade) ||
      !isStr(c.primary_theme) ||
      !isStr(c.headline) ||
      !isStr(c.summary) ||
      (c.confidence !== "low" && c.confidence !== "medium" && c.confidence !== "high")
    ) {
      return null;
    }
    return {
      positioningGrade: Math.round(c.positioning_grade),
      resilienceGrade: Math.round(c.resilience_grade),
      materialityGrade: Math.round(c.materiality_grade),
      primaryTheme: c.primary_theme,
      headline: c.headline,
      summary: c.summary,
      confidence: c.confidence,
    };
  } catch {
    return null;
  }
}

export function confidenceWeight(confidence: "low" | "medium" | "high"): number {
  return confidence === "high" ? 0.9 : confidence === "medium" ? 0.6 : 0.3;
}
