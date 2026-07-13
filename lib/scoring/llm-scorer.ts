import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
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
 * The returned `SignalValue` plugs straight into the scoring engine: the LLM
 * score becomes the `raw` number, evidence rows are carried through. Engine
 * normalises across candidates the same as any quantitative signal.
 *
 * Cost discipline: each call is one Sonnet message with a tight system prompt
 * and a JSON-only response. Budget: ~600 input + 200 output tokens per
 * candidate per qualitative criterion. Five agents × five candidates × three
 * qualitative criteria ≈ £0.10/run on Sonnet 4.5 pricing — fine.
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
  /** Override model — defaults to Sonnet. */
  model?: string;
}

interface LlmGrade {
  score: number; // 0–100
  justification: string;
  confidence: "low" | "medium" | "high";
}

const SYSTEM_PROMPT = `You are a buy-side investment analyst grading one criterion of one security.

Return ONLY a JSON object with this exact shape:
{
  "score": <integer 0-100>,
  "justification": "<two to four sentence rationale citing the evidence>",
  "confidence": "low" | "medium" | "high"
}

Scoring discipline:
- 0-20: severe negative on this criterion. Material concern.
- 21-40: weak. Below peer median.
- 41-60: average. Defensible but unremarkable.
- 61-80: above peer median. Real strength.
- 81-100: best in class on this criterion within this peer set.

Use "low" confidence when the evidence is thin or contradictory. Do not invent
facts. If the evidence is genuinely insufficient to grade, return score=50,
confidence="low" with a justification explaining what was missing.

Respond with ONLY the JSON object, no preamble, no markdown fences.`;

export async function scoreWithLlm(
  request: LlmScoringRequest,
): Promise<SignalValue> {
  const client = getAnthropicClient();
  const truncatedContext = request.context.slice(0, 6_000);

  const userPrompt = `Criterion: ${request.criterion}

Rubric:
${request.rubric}

Evidence to consider:
${truncatedContext}`;

  try {
    const response = await client.messages.create({
      model: request.model ?? MODELS.default,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find(
      (block) => block.type === "text",
    );
    if (!textBlock || textBlock.type !== "text") {
      return { raw: null, evidence: request.evidence };
    }
    const grade = parseGrade(textBlock.text);
    if (!grade) return { raw: null, evidence: request.evidence };

    // Stash the justification on the first evidence item so it surfaces in the
    // report alongside the source rows the model was grounding against.
    const annotatedEvidence: EvidenceItem[] = request.evidence.length
      ? [
          {
            ...request.evidence[0],
            text: `[${request.criterion} · score ${grade.score} · ${grade.confidence}] ${grade.justification}\n\n${request.evidence[0].text}`,
          },
          ...request.evidence.slice(1),
        ]
      : [
          {
            type: "derived_metric",
            sourceTable: "agent_runs",
            sourceId: "llm_grade",
            text: `[${request.criterion} · score ${grade.score} · ${grade.confidence}] ${grade.justification}`,
            weight: grade.confidence === "high" ? 0.9 : grade.confidence === "medium" ? 0.6 : 0.3,
          },
        ];

    return { raw: grade.score, evidence: annotatedEvidence };
  } catch (err) {
    // Don't throw — let the engine treat this as a null signal for this
    // candidate. One model hiccup shouldn't kill the whole run.
    console.error(`scoreWithLlm failed for ${request.criterion}:`, getErrorMessage(err));
    return { raw: null, evidence: request.evidence };
  }
}

function parseGrade(text: string): LlmGrade | null {
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed.score === "number" &&
      parsed.score >= 0 &&
      parsed.score <= 100 &&
      typeof parsed.justification === "string" &&
      (parsed.confidence === "low" ||
        parsed.confidence === "medium" ||
        parsed.confidence === "high")
    ) {
      return {
        score: Math.round(parsed.score),
        justification: parsed.justification,
        confidence: parsed.confidence,
      };
    }
    return null;
  } catch {
    // Last-ditch: scrape a bare integer 0–100 from the response.
    const match = /\b(\d{1,3})\b/.exec(cleaned);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 0 && n <= 100) {
        return { score: n, justification: cleaned.slice(0, 400), confidence: "low" };
      }
    }
    return null;
  }
}
