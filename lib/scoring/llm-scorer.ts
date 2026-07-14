import { getAnthropicClient, modelForTier, type ModelTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";
import type { EvidenceItem } from "@/lib/agents/types";
import type { SignalValue } from "./types";

/**
 * LLM-driven qualitative scoring.
 *
 * Some criteria can't be reduced to a number out of the database — management
 * quality, competitive moat, regulatory exposure, narrative coherence. For
 * these, the agent gathers evidence (filing sections, news, peer commentary)
 * and asks the model to grade 0–100 with a justification.
 *
 * The returned `SignalValue` plugs straight into the scoring engine. The grade
 * is CALIBRATED (0–20 material concern … 81–100 best in class), so framework
 * sub-signals backed by this scorer should use `normalisation: "absolute"` —
 * rank-normalising a calibrated grade across peers destroys the calibration.
 *
 * Output shape is enforced with structured outputs (output_config.format), so
 * there is no prose-parsing fallback. Sonnet 5 runs adaptive thinking by
 * default and it shares max_tokens, so effort is pinned low and the budget
 * leaves headroom.
 */

export interface LlmScoringRequest {
  /** What we're grading — e.g. "management quality" or "moat durability". */
  criterion: string;
  /** Plain-English description of the rubric. */
  rubric: string;
  /** Free-text context the model should consider. Trimmed to ~6000 chars. */
  context: string;
  /** Evidence rows to carry through onto the final score. */
  evidence: EvidenceItem[];
  /** Model tier — defaults to routine. */
  tier?: ModelTier;
}

export interface LlmGrade {
  score: number; // 0–100
  justification: string;
  confidence: "low" | "medium" | "high";
}

export const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "Calibrated grade 0-100 per the scoring discipline.",
    },
    justification: {
      type: "string",
      description: "Two to four sentence rationale citing the evidence.",
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "low when the evidence is thin or contradictory; high only when well-grounded.",
    },
  },
  required: ["score", "justification", "confidence"],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You are a buy-side investment analyst grading one criterion of one security.

Scoring discipline (absolute, NOT relative to the current peer set):
- 0-20: severe negative on this criterion. Material concern.
- 21-40: weak.
- 41-60: average. Defensible but unremarkable.
- 61-80: real strength.
- 81-100: best in class.

Use "low" confidence when the evidence is thin or contradictory. Do not invent
facts. If the evidence is genuinely insufficient to grade, return score=50,
confidence="low" with a justification explaining what was missing.`;

/** Shared by the single-call and Batch API paths — one prompt shape, one grade contract. */
export function buildUserPrompt(request: LlmScoringRequest): string {
  return `Criterion: ${request.criterion}

Rubric:
${request.rubric}

Evidence to consider:
${request.context.slice(0, 6_000)}`;
}

/**
 * Map a raw structured-outputs text payload to the engine's SignalValue
 * contract: valid grade → calibrated raw score with annotated evidence;
 * anything else → null signal (weight redistributes, never zero).
 */
export function gradeTextToSignalValue(
  request: LlmScoringRequest,
  text: string,
): SignalValue {
  const grade = validateGrade(text);
  if (!grade) return { raw: null, evidence: request.evidence };
  return { raw: grade.score, evidence: annotateEvidence(request, grade) };
}

export async function scoreWithLlm(
  request: LlmScoringRequest,
): Promise<SignalValue> {
  const client = getAnthropicClient();
  const userPrompt = buildUserPrompt(request);

  try {
    const response = await client.messages.create({
      model: modelForTier(request.tier ?? "routine"),
      // Adaptive thinking (default-on for sonnet-5) shares this budget; keep
      // headroom so the grade never truncates.
      max_tokens: 2_000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: GRADE_SCHEMA,
        },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      console.error(
        `scoreWithLlm: unusable stop_reason=${response.stop_reason} for ${request.criterion}`,
      );
      return { raw: null, evidence: request.evidence };
    }

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { raw: null, evidence: request.evidence };
    }
    return gradeTextToSignalValue(request, textBlock.text);
  } catch (err) {
    // Don't throw — let the engine treat this as a null signal for this
    // candidate. One model hiccup shouldn't kill the whole run.
    console.error(
      `scoreWithLlm failed for ${request.criterion}:`,
      getErrorMessage(err),
    );
    return { raw: null, evidence: request.evidence };
  }
}

/**
 * Structured outputs guarantee schema-valid JSON, but guard anyway: the value
 * ranges (0–100) aren't expressible in the supported schema subset, and a
 * defensive parse keeps the engine's null-signal contract intact if the API
 * ever returns something unexpected.
 */
export function validateGrade(text: string): LlmGrade | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.score === "number" &&
      Number.isFinite(candidate.score) &&
      candidate.score >= 0 &&
      candidate.score <= 100 &&
      typeof candidate.justification === "string" &&
      (candidate.confidence === "low" ||
        candidate.confidence === "medium" ||
        candidate.confidence === "high")
    ) {
      return {
        score: Math.round(candidate.score),
        justification: candidate.justification,
        confidence: candidate.confidence,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Stash the justification on the first evidence item so it surfaces in the
 * report alongside the source rows the model was grounding against. The
 * confidence maps to the evidence weight when the scorer had to synthesise
 * its own evidence row.
 */
export function annotateEvidence(
  request: LlmScoringRequest,
  grade: LlmGrade,
): EvidenceItem[] {
  const label = `[${request.criterion} · score ${grade.score} · ${grade.confidence}] ${grade.justification}`;
  if (request.evidence.length > 0) {
    return [
      { ...request.evidence[0], text: `${label}\n\n${request.evidence[0].text}` },
      ...request.evidence.slice(1),
    ];
  }
  return [
    {
      type: "derived_metric",
      sourceTable: "agent_runs",
      sourceId: "llm_grade",
      text: label,
      weight:
        grade.confidence === "high" ? 0.9 : grade.confidence === "medium" ? 0.6 : 0.3,
    },
  ];
}
