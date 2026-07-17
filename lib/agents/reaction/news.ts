import { getAnthropicClient, modelForTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";

/**
 * News layer for the Reaction Analyser: one deep-tier call per screened
 * name, with the native web_search server tool and structured outputs.
 *
 * The model researches WHY the name dropped and returns two calibrated 0–100
 * grades:
 *   damageSeverity — how much real, fundamental damage the news implies
 *                    (0 = transient noise, 100 = existential impairment)
 *   disproportion  — how disproportionate the price move looks GIVEN that
 *                    news (0 = fully justified, 100 = wildly overdone)
 *
 * Both are absolute-calibrated, so the framework consumes them with
 * normalisation: "absolute". Language discipline (I2): grades describe the
 * SECURITY and the MOVE, never anyone's position in it.
 *
 * Failure contract: any error or refusal returns null — the engine
 * redistributes the weight and coverage records the gap.
 */

export interface ReactionNewsRequest {
  ticker: string;
  exchange: string;
  name: string;
  /** Fractional returns, e.g. -0.14. */
  return1d: number | null;
  return5d: number | null;
  asOf: string; // YYYY-MM-DD
}

export interface ReactionNewsGrade {
  damageSeverity: number;
  disproportion: number;
  headline: string;
  summary: string;
  sources: { url: string; title: string }[];
  confidence: "low" | "medium" | "high";
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    damage_severity: {
      type: "integer",
      description:
        "0-100 calibrated: 0 = no real fundamental damage (noise, sympathy move, technical flow); 50 = meaningful but recoverable earnings impact; 100 = existential/permanent impairment.",
    },
    disproportion: {
      type: "integer",
      description:
        "0-100 calibrated: 0 = the price move is fully justified by the news; 50 = move looks somewhat stretched; 100 = move is wildly disproportionate to the identified cause.",
    },
    headline: {
      type: "string",
      description: "One sentence: what happened.",
    },
    summary: {
      type: "string",
      description:
        "3-6 sentences: the identified cause of the drop, the concrete facts (numbers where reported), and why the grades were chosen. Impersonal language only.",
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["url", "title"],
        additionalProperties: false,
      },
      description: "The web sources actually relied upon.",
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description:
        "low when no clear cause was found or sources conflict; high only when the cause is well-documented.",
    },
  },
  required: [
    "damage_severity",
    "disproportion",
    "headline",
    "summary",
    "sources",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a buy-side event analyst. A stock has just fallen sharply; your job is to identify WHY from current news and grade two things on absolute 0-100 scales: how much real fundamental damage the cause implies, and how disproportionate the price move is given that cause.

Discipline:
- Search for and rely on concrete, current reporting. Cite what you used.
- Grades are ABSOLUTE (calibrated across all stocks and time), not relative to today's screen.
- If you cannot identify a credible cause, say so: damage_severity near 50, confidence "low", and a summary stating that no clear cause was found.
- Describe the security and the move. Never address any reader's holdings, decisions, or circumstances; no recommendations.`;

function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

/**
 * One retry on ANY failure path (API error, refusal, token exhaustion,
 * unparseable output). The news grade is the defining input of an overshoot
 * verdict — a name without it is excluded from the ranking entirely — so a
 * transient failure is worth one more slow call. Persistent failure still
 * returns null and the agent classifies the name `cause_unconfirmed`.
 */
export async function gradeReactionNews(
  request: ReactionNewsRequest,
): Promise<ReactionNewsGrade | null> {
  const first = await attemptGrade(request);
  if (first) return first;
  console.warn(`gradeReactionNews: retrying ${request.ticker} after empty result`);
  return attemptGrade(request);
}

async function attemptGrade(
  request: ReactionNewsRequest,
): Promise<ReactionNewsGrade | null> {
  const client = getAnthropicClient();
  const userPrompt = `Security: ${request.name} (${request.ticker}, ${request.exchange})
As of ${request.asOf}, the shares are down ${pct(request.return1d)} over 1 trading day and ${pct(request.return5d)} over 5 trading days.

Research what caused this move and grade it per the discipline.`;

  try {
    const response = await client.messages.create({
      model: modelForTier("routine"),
      // web_search rounds + thinking share this budget; hitting the ceiling
      // returns stop_reason=max_tokens and costs the name its verdict, so
      // leave real headroom.
      max_tokens: 10_000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: GRADE_SCHEMA },
      },
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
      ],
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (
      response.stop_reason === "refusal" ||
      response.stop_reason === "max_tokens"
    ) {
      console.error(
        `gradeReactionNews: unusable stop_reason=${response.stop_reason} for ${request.ticker}`,
      );
      return null;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseGrade(textBlock.text);
  } catch (err) {
    console.error(
      `gradeReactionNews failed for ${request.ticker}: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

/** Defensive parse — exported for tests. Ranges aren't schema-expressible. */
export function parseGrade(text: string): ReactionNewsGrade | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    const inRange = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
    if (
      !inRange(c.damage_severity) ||
      !inRange(c.disproportion) ||
      typeof c.headline !== "string" ||
      typeof c.summary !== "string" ||
      !Array.isArray(c.sources) ||
      (c.confidence !== "low" && c.confidence !== "medium" && c.confidence !== "high")
    ) {
      return null;
    }
    const sources = c.sources
      .filter(
        (s): s is { url: string; title: string } =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as Record<string, unknown>).url === "string" &&
          typeof (s as Record<string, unknown>).title === "string",
      )
      .slice(0, 8);
    return {
      damageSeverity: Math.round(c.damage_severity),
      disproportion: Math.round(c.disproportion),
      headline: c.headline,
      summary: c.summary,
      sources,
      confidence: c.confidence,
    };
  } catch {
    return null;
  }
}

export function confidenceWeight(confidence: "low" | "medium" | "high"): number {
  return confidence === "high" ? 0.9 : confidence === "medium" ? 0.6 : 0.3;
}
