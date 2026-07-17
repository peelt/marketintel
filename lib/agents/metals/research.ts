import { getAnthropicClient, modelForTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";

/**
 * Cost-position research for the Metals desk: one deep-tier call per producer
 * with the native web_search tool and structured output (the same proven
 * pattern as the Reaction news layer).
 *
 * AISC (all-in sustaining cost, $/oz) is the desk's anchor and lives only in
 * company reporting — no free API serves it. The model researches the latest
 * reported AISC (or, for royalty/streaming companies, the effective economics
 * of their streams) and grades COST MARGIN 0–100 ABSOLUTE, calibrated across
 * producers and time given the current metal price — so the framework consumes
 * it with normalisation: "absolute".
 *
 * Failure contract: null on any failure after one retry — the engine
 * redistributes the weight and coverage records the gap (missing ≠ zero).
 * Language discipline (I2): describes the COMPANY's cost position, never
 * anyone's holdings.
 */

export interface MetalsResearchRequest {
  ticker: string;
  exchange: string;
  name: string;
  /** "miner" drives AISC framing; "royalty" the stream-economics framing. */
  kind: "miner" | "royalty";
  /** Metal spot context, if available ("gold ~$2,610/oz"). */
  metalContext: string | null;
  asOf: string; // YYYY-MM-DD
}

export interface MetalsResearchGrade {
  costMarginGrade: number; // 0-100 absolute
  reportedAiscUsd: number | null; // $/oz where disclosed; null for royalties/undisclosed
  headline: string;
  summary: string;
  sources: { url: string; title: string }[];
  confidence: "low" | "medium" | "high";
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    cost_margin_grade: {
      type: "integer",
      description:
        "0-100 ABSOLUTE, calibrated across all precious-metals producers and time: 0 = producing at or above the current metal price (no margin, existential at spot); 50 = middling cost position for the industry; 100 = lowest-decile costs with an exceptionally wide margin at the current metal price. For royalty/streaming companies grade the effective economics of the portfolio (fixed low per-ounce costs usually imply a high grade).",
    },
    reported_aisc_usd: {
      type: ["number", "null"],
      description:
        "Latest company-reported AISC in USD per ounce (gold-equivalent where applicable). null when not disclosed or not meaningful (royalties).",
    },
    headline: {
      type: "string",
      description: "One sentence: the company's cost position in plain terms.",
    },
    summary: {
      type: "string",
      description:
        "3-5 sentences: the latest reported AISC or stream economics with the reporting period, how that compares to the current metal price, and any disclosed cost guidance. Impersonal language only.",
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
        "low when no recent cost disclosure was found; high only when a current-period AISC (or stream economics) is well documented.",
    },
  },
  required: [
    "cost_margin_grade",
    "reported_aisc_usd",
    "headline",
    "summary",
    "sources",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a mining-sector cost analyst. Your job is to research a precious-metals company's latest reported production costs and grade its COST POSITION on an absolute 0-100 scale given the current metal price.

Discipline:
- Find the latest reported AISC (all-in sustaining cost, USD/oz) from company reporting or reliable coverage; for royalty/streaming companies, assess the effective per-ounce economics of the portfolio instead.
- The grade is ABSOLUTE (calibrated across all producers and time), not relative to today's list.
- State the reporting period the figure comes from. Prefer the most recent quarter/year available.
- If no recent cost disclosure can be found, say so: grade near 50, confidence "low".
- Report reported_aisc_usd as a PLAIN number of US dollars per ounce (e.g. 1310), in the metal's own ounce terms — never scaled, never in cents.
- Describe the company and its costs. Never address any reader's holdings or decisions; no recommendations.`;

/** One retry on any failure path — same contract as the Reaction news layer. */
export async function gradeMetalsCost(
  request: MetalsResearchRequest,
): Promise<MetalsResearchGrade | null> {
  const first = await attemptGrade(request);
  if (first) return first;
  console.warn(`gradeMetalsCost: retrying ${request.ticker} after empty result`);
  return attemptGrade(request);
}

async function attemptGrade(
  request: MetalsResearchRequest,
): Promise<MetalsResearchGrade | null> {
  const client = getAnthropicClient();
  const kindLine =
    request.kind === "royalty"
      ? "This is a ROYALTY/STREAMING company — grade the effective economics of its stream portfolio rather than mine-level AISC."
      : "This is a producing miner — anchor on its latest reported AISC.";
  const userPrompt = `Company: ${request.name} (${request.ticker}, ${request.exchange})
${kindLine}
${request.metalContext ? `Current metal price context: ${request.metalContext}.` : ""}
As of ${request.asOf}, research the latest reported costs and grade the cost position per the discipline.`;

  try {
    const response = await client.messages.create({
      model: modelForTier("routine"),
      // web_search rounds + thinking share this budget; hitting the ceiling
      // costs the name its cost grade, so leave real headroom.
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
        `gradeMetalsCost: unusable stop_reason=${response.stop_reason} for ${request.ticker}`,
      );
      return null;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseMetalsGrade(textBlock.text);
  } catch (err) {
    console.error(
      `gradeMetalsCost failed for ${request.ticker}: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

/** Defensive parse — exported for tests. Ranges aren't schema-expressible. */
export function parseMetalsGrade(text: string): MetalsResearchGrade | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    const inRange = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
    if (
      !inRange(c.cost_margin_grade) ||
      typeof c.headline !== "string" ||
      typeof c.summary !== "string" ||
      !Array.isArray(c.sources) ||
      (c.confidence !== "low" && c.confidence !== "medium" && c.confidence !== "high")
    ) {
      return null;
    }
    // Plausibility bound: real per-ounce costs run ~$5 (silver royalties) to
    // low thousands (gold miners). A wildly out-of-range figure (seen live:
    // AISC ~$2.6e28/oz on AEM, alongside a garbled headline and a grade that
    // contradicted its own summary) marks the WHOLE generation as corrupted —
    // reject it so the retry path gets a clean attempt, rather than salvaging
    // a grade from a broken output.
    const rawAisc =
      typeof c.reported_aisc_usd === "number" &&
      Number.isFinite(c.reported_aisc_usd) &&
      c.reported_aisc_usd > 0
        ? c.reported_aisc_usd
        : null;
    if (rawAisc !== null && (rawAisc < 5 || rawAisc > 20_000)) return null;
    const aisc = rawAisc;
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
      costMarginGrade: Math.round(c.cost_margin_grade),
      reportedAiscUsd: aisc,
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

// ---------- deterministic margin cross-check ----------

/**
 * Calibrated cost grade IMPLIED by the disclosed AISC against the current
 * spot price — the glass-box arithmetic the LLM grade must agree with.
 * The AISC's scale picks the metal (silver producers report ~$10–30/oz,
 * gold producers ~$800–2,000/oz). Null when no spot is available.
 */
export function impliedCostGrade(
  aiscUsd: number,
  goldSpotUsd: number | null,
  silverSpotUsd: number | null,
): number | null {
  const spot = aiscUsd < 100 ? silverSpotUsd : goldSpotUsd;
  if (spot == null || spot <= 0) return null;
  const margin = (spot - aiscUsd) / spot;
  if (margin <= 0) return 5;
  if (margin <= 0.15) return 25;
  if (margin <= 0.3) return 45;
  if (margin <= 0.45) return 60;
  if (margin <= 0.6) return 75;
  return 90;
}

/**
 * Reconcile the LLM's grade with the arithmetic its own AISC implies. Seen
 * live (AEM): a summary describing "one of the industry's lowest-cost
 * producers" alongside cost_margin_grade = 1 — which classified a premier
 * miner "vulnerable". When the disclosed AISC and the spot price imply a
 * grade wildly different from the model's number, the arithmetic wins: the
 * evidence card already shows the AISC and metal price, so the deterministic
 * grade is the one the reader can verify.
 */
const RECONCILE_TOLERANCE = 30;

export function reconcileCostGrade(
  grade: MetalsResearchGrade,
  goldSpotUsd: number | null,
  silverSpotUsd: number | null,
): MetalsResearchGrade {
  if (grade.reportedAiscUsd == null) return grade;
  const implied = impliedCostGrade(grade.reportedAiscUsd, goldSpotUsd, silverSpotUsd);
  if (implied == null) return grade;
  if (Math.abs(grade.costMarginGrade - implied) <= RECONCILE_TOLERANCE) return grade;
  console.warn(
    `reconcileCostGrade: model grade ${grade.costMarginGrade} contradicts AISC $${grade.reportedAiscUsd}/oz vs spot — using implied ${implied}`,
  );
  return { ...grade, costMarginGrade: implied };
}
