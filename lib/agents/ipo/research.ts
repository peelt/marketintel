import { getAnthropicClient, modelForTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";

/**
 * Prospectus evaluation for the IPO desk: one routine-tier call per issuer,
 * structured output, NO web search — the S-1/F-1 itself is the evidence
 * source, which keeps the desk cheap and every grade traceable to a filing
 * the reader can open.
 *
 * Five dimensions are graded 0–100 ABSOLUTE (calibrated across IPOs and
 * time) so the framework consumes them with normalisation: "absolute" and a
 * quiet filing week stays comparable to a busy one.
 *
 * Failure contract: null after one retry — the engine redistributes weight
 * and coverage records the gap (missing ≠ zero). Language discipline (I2):
 * describes the ISSUER and its offering, never any reader's decision.
 */

export interface IpoEvalRequest {
  name: string;
  filingType: string; // S-1 | F-1
  filedAt: string; // ISO
  /** Sectionised prospectus excerpt from discovery. */
  excerpt: string;
  asOf: string; // YYYY-MM-DD
}

export interface IpoEval {
  businessQualityGrade: number;
  businessQualityNote: string;
  growthGrade: number;
  growthNote: string;
  riskGrade: number;
  riskNote: string;
  governanceGrade: number;
  governanceNote: string;
  offeringTermsGrade: number;
  offeringTermsNote: string;
  headline: string;
  summary: string;
  proposedTicker: string | null;
  isShellOrSpac: boolean;
  confidence: "low" | "medium" | "high";
}

const gradeField = (description: string) => ({
  type: "integer",
  description,
});
const noteField = (description: string) => ({
  type: "string",
  description: `${description} 1-2 sentences, grounded in the prospectus text.`,
});

const EVAL_SCHEMA = {
  type: "object",
  properties: {
    business_quality_grade: gradeField(
      "0-100 ABSOLUTE, calibrated across all IPOs and time: durability of the business model, competitive position and unit economics AS DISCLOSED. 0 = no real business or hopeless economics; 50 = ordinary, unproven; 100 = exceptional franchise with demonstrated economics.",
    ),
    business_quality_note: noteField("Why the business quality grade."),
    growth_grade: gradeField(
      "0-100 ABSOLUTE: disclosed revenue trajectory and credible runway. Grade the DISCLOSED numbers, not the marketing TAM claims. 0 = shrinking or no revenue; 50 = modest growth; 100 = rapid, well-evidenced compounding.",
    ),
    growth_note: noteField("Why the growth grade."),
    risk_grade: gradeField(
      "0-100 ABSOLUTE where HIGHER = MORE MANAGEABLE risk. 100 = only ordinary-course risk factors; 50 = notable but survivable concentrations; 0 = existential red flags (going-concern doubt, single-customer dependence, unresolved litigation or regulatory threat to the core business).",
    ),
    risk_note: noteField("The most material specific risk factors."),
    governance_grade: gradeField(
      "0-100 ABSOLUTE where HIGHER = CLEANER governance. Penalise super-voting dual-class structures, controlled-company status, heavy related-party dealings, and unusually broad indemnification; reward single-class stock and independent oversight.",
    ),
    governance_note: noteField("The governance facts behind the grade."),
    offering_terms_grade: gradeField(
      "0-100 ABSOLUTE where HIGHER = CLEANER offering. Reward a primary raise with specific use of proceeds; penalise heavy selling-shareholder participation, vague 'general corporate purposes' proceeds, and severe disclosed dilution.",
    ),
    offering_terms_note: noteField("The offering-terms facts behind the grade."),
    headline: {
      type: "string",
      description:
        "One sentence: what the company does and what it is offering. Impersonal.",
    },
    summary: {
      type: "string",
      description:
        "3-5 sentences: the business, the disclosed financial picture (with figures where stated), and the shape of the offering. Impersonal language only — describe the issuer, never advise a reader.",
    },
    proposed_ticker: {
      type: ["string", "null"],
      description:
        "The proposed listing ticker from the cover page (e.g. 'ACME'), or null when not yet disclosed.",
    },
    is_shell_or_spac: {
      type: "boolean",
      description:
        "true when the registrant is a blank-check/SPAC or shell with no operating business to evaluate.",
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "low when financial disclosure is thin or heavily redacted; high only when the excerpt supports every grade with specifics.",
    },
  },
  required: [
    "business_quality_grade",
    "business_quality_note",
    "growth_grade",
    "growth_note",
    "risk_grade",
    "risk_note",
    "governance_grade",
    "governance_note",
    "offering_terms_grade",
    "offering_terms_note",
    "headline",
    "summary",
    "proposed_ticker",
    "is_shell_or_spac",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are an equity analyst evaluating a company's IPO registration statement from its own prospectus text. You are given sectionised excerpts of the actual S-1/F-1; grade ONLY from what the filing discloses.

Discipline:
- All grades are ABSOLUTE (calibrated across all IPOs and time), never relative to this week's filings.
- Ground every note in specific prospectus content — figures, named risks, stated terms. Never invent facts the excerpt doesn't contain.
- Where a section was truncated or absent, grade what IS disclosed and reflect thinness in "confidence", not in invented specifics.
- Flag blank-check/SPAC and shell registrants: they have no operating business to grade.
- Describe the issuer and its offering. Never address any reader's holdings or decisions; no recommendations.`;

/** One retry on any failure path — same contract as the other research layers. */
export async function evaluateProspectus(
  request: IpoEvalRequest,
): Promise<IpoEval | null> {
  const first = await attemptEval(request);
  if (first) return first;
  console.warn(`evaluateProspectus: retrying ${request.name} after empty result`);
  return attemptEval(request);
}

async function attemptEval(request: IpoEvalRequest): Promise<IpoEval | null> {
  const client = getAnthropicClient();
  const userPrompt = `Issuer: ${request.name}
Filing: ${request.filingType}, filed ${request.filedAt.slice(0, 10)}. Evaluated as of ${request.asOf}.

Prospectus excerpts follow. Grade per the discipline.

${request.excerpt}`;

  try {
    const response = await client.messages.create({
      model: modelForTier("routine"),
      // Thinking shares this budget with the structured output; the notes and
      // summary are small, but a large prospectus invites long thinking.
      max_tokens: 8_000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: EVAL_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (
      response.stop_reason === "refusal" ||
      response.stop_reason === "max_tokens"
    ) {
      console.error(
        `evaluateProspectus: unusable stop_reason=${response.stop_reason} for ${request.name}`,
      );
      return null;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseIpoEval(textBlock.text);
  } catch (err) {
    console.error(
      `evaluateProspectus failed for ${request.name}: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

/** Defensive parse — exported for tests. Ranges aren't schema-expressible. */
export function parseIpoEval(text: string): IpoEval | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    const inRange = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
    const isStr = (v: unknown): v is string => typeof v === "string";
    if (
      !inRange(c.business_quality_grade) ||
      !inRange(c.growth_grade) ||
      !inRange(c.risk_grade) ||
      !inRange(c.governance_grade) ||
      !inRange(c.offering_terms_grade) ||
      !isStr(c.business_quality_note) ||
      !isStr(c.growth_note) ||
      !isStr(c.risk_note) ||
      !isStr(c.governance_note) ||
      !isStr(c.offering_terms_note) ||
      !isStr(c.headline) ||
      !isStr(c.summary) ||
      typeof c.is_shell_or_spac !== "boolean" ||
      (c.confidence !== "low" && c.confidence !== "medium" && c.confidence !== "high")
    ) {
      return null;
    }
    // Ticker: accept a plausible symbol only — anything else becomes null
    // rather than polluting the securities table.
    const rawTicker = isStr(c.proposed_ticker) ? c.proposed_ticker.trim().toUpperCase() : null;
    const proposedTicker =
      rawTicker && /^[A-Z]{1,5}(\.[A-Z])?$/.test(rawTicker) ? rawTicker : null;
    return {
      businessQualityGrade: Math.round(c.business_quality_grade),
      businessQualityNote: c.business_quality_note,
      growthGrade: Math.round(c.growth_grade),
      growthNote: c.growth_note,
      riskGrade: Math.round(c.risk_grade),
      riskNote: c.risk_note,
      governanceGrade: Math.round(c.governance_grade),
      governanceNote: c.governance_note,
      offeringTermsGrade: Math.round(c.offering_terms_grade),
      offeringTermsNote: c.offering_terms_note,
      headline: c.headline,
      summary: c.summary,
      proposedTicker,
      isShellOrSpac: c.is_shell_or_spac,
      confidence: c.confidence,
    };
  } catch {
    return null;
  }
}

export function confidenceWeight(confidence: "low" | "medium" | "high"): number {
  return confidence === "high" ? 0.9 : confidence === "medium" ? 0.6 : 0.3;
}
