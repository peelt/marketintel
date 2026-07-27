import { getAnthropicClient, modelForTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";

/**
 * Reaction's MACRO LAYER — one web-research call per run that establishes the
 * backdrop the day's drops are attributed against.
 *
 * This is the rebuilt half of the retired Geopolitical desk (2026-07 scope
 * reduction): that desk's macro read was the only part intrinsic to Reaction's
 * question. It is deliberately a SEPARATE module from
 * lib/agents/geopolitical/macro.ts — the retired desk's code stays frozen so
 * its historical reports keep rendering, and the framing here is different.
 * The geopolitical desk asked "which themes matter to markets" in order to
 * grade standing exposure; Reaction asks "what is moving equity prices RIGHT
 * NOW", because its use is attribution: did this name fall on its own news, or
 * did it fall with everything else?
 *
 * Without it, every screened name's news call re-discovers the same macro story
 * independently. With it, each call gets the same backdrop and answers one more
 * question — idiosyncratic, amplified, or macro-driven — which is what makes a
 * "sector-wide sell-off, nothing new at this name" overshoot explicit and
 * evidenced rather than buried in prose.
 *
 * Fresh every run (a backdrop a day old is a different backdrop), so NOT
 * cached. Failure contract: null after one retry — names are then graded with
 * no themes block exactly as before this layer existed, and the report says the
 * read was unavailable rather than implying every drop was idiosyncratic.
 * Language discipline (I2): describes the market backdrop, never a reader's
 * holdings, and never a market call.
 */

export interface MacroTheme {
  title: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  /** Which way the theme cuts, in plain terms. */
  direction: string;
  affectedSectors: string[];
}

export interface MacroRead {
  themes: MacroTheme[];
  asOfNote: string;
  sources: { url: string; title: string }[];
}

const MACRO_SCHEMA = {
  type: "object",
  properties: {
    themes: {
      type: "array",
      description:
        "2-5 macro developments that are ACTIVELY MOVING equity prices in the last few sessions, most consequential first. Only themes with observable price impact — not a general survey of world events.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Short theme name, e.g. 'Advanced-semiconductor export controls'.",
          },
          summary: {
            type: "string",
            description:
              "2-3 sentences: what happened, when, and which parts of the market have visibly moved on it. Factual and impersonal.",
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
            description:
              "Confidence that this theme is real and is actually driving price action right now: high = well-documented with clear, dated market impact; low = emerging or speculative.",
          },
          direction: {
            type: "string",
            description:
              "One phrase on which way it cuts, e.g. 'pressure on China-exposed chipmakers, tailwind for domestic foundries'.",
          },
          affected_sectors: {
            type: "array",
            items: { type: "string" },
            description:
              "Sectors or groups whose share prices this bears on, in plain terms (e.g. 'semiconductors', 'UK housebuilders', 'oil majors').",
          },
        },
        required: [
          "title",
          "summary",
          "confidence",
          "direction",
          "affected_sectors",
        ],
        additionalProperties: false,
      },
    },
    as_of_note: {
      type: "string",
      description:
        "One sentence framing this as a snapshot of the current backdrop, with its inherent uncertainty.",
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
  },
  required: ["themes", "as_of_note", "sources"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a market analyst briefing an equity-research desk before it reviews the day's sharpest fallers. Identify what is CURRENTLY moving equity prices — the macro developments a sharp single-name drop might be attributable to rather than to company-specific news.

Discipline:
- Only include themes with observable, recent market impact. This is not a survey of world events: a serious geopolitical story that markets have not moved on does not belong here.
- Cover the drivers that actually push share prices: policy and geopolitical shocks, rate and inflation surprises, commodity moves, sector-wide de-ratings. Both US and UK markets are in scope.
- Be specific about which sectors or groups have moved, and which way the theme cuts.
- State confidence honestly. Prefer few well-evidenced themes over a long speculative list.
- Describe the market. NEVER give a market call, price target, or any instruction to a reader. No "buy"/"sell"/"investors should".`;

/** Schema asks for 2–5; enforce the ceiling the model was told about. */
const MAX_THEMES = 5;

export async function researchReactionMacro(
  asOf: string,
): Promise<MacroRead | null> {
  const first = await attemptMacro(asOf);
  if (first) return first;
  console.warn("researchReactionMacro: retrying after empty result");
  return attemptMacro(asOf);
}

async function attemptMacro(asOf: string): Promise<MacroRead | null> {
  const client = getAnthropicClient();
  const userPrompt = `As of ${asOf}, research what is currently moving equity prices in the US and UK markets, and return the active themes per the discipline.`;

  try {
    const response = await client.messages.create({
      model: modelForTier("routine"),
      max_tokens: 10_000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: MACRO_SCHEMA },
      },
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (
      response.stop_reason === "refusal" ||
      response.stop_reason === "max_tokens"
    ) {
      console.error(
        `researchReactionMacro: unusable stop_reason=${response.stop_reason}`,
      );
      return null;
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseMacroRead(textBlock.text);
  } catch (err) {
    console.error(`researchReactionMacro failed: ${getErrorMessage(err)}`);
    return null;
  }
}

/** Defensive parse — exported for tests. */
export function parseMacroRead(text: string): MacroRead | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    if (!Array.isArray(c.themes) || typeof c.as_of_note !== "string") return null;
    const conf = (v: unknown): v is "low" | "medium" | "high" =>
      v === "low" || v === "medium" || v === "high";
    const themes: MacroTheme[] = [];
    for (const raw of c.themes) {
      if (typeof raw !== "object" || raw === null) continue;
      const t = raw as Record<string, unknown>;
      if (
        typeof t.title !== "string" ||
        typeof t.summary !== "string" ||
        !conf(t.confidence) ||
        typeof t.direction !== "string"
      ) {
        continue;
      }
      themes.push({
        title: t.title,
        summary: t.summary,
        confidence: t.confidence,
        direction: t.direction,
        affectedSectors: Array.isArray(t.affected_sectors)
          ? t.affected_sectors.filter((s): s is string => typeof s === "string")
          : [],
      });
    }
    if (themes.length === 0) return null;
    const sources = Array.isArray(c.sources)
      ? c.sources
          .filter(
            (s): s is { url: string; title: string } =>
              typeof s === "object" &&
              s !== null &&
              typeof (s as Record<string, unknown>).url === "string" &&
              typeof (s as Record<string, unknown>).title === "string",
          )
          .slice(0, 8)
      : [];
    return {
      themes: themes.slice(0, MAX_THEMES),
      asOfNote: c.as_of_note,
      sources,
    };
  } catch {
    return null;
  }
}

/**
 * Compact themes block injected into every per-name news prompt. Titles are
 * numbered because the grader must echo one back verbatim to attribute a drop
 * — see `resolveMacroTheme` in news.ts.
 */
export function themesForPrompt(read: MacroRead): string {
  return read.themes
    .map(
      (t, i) =>
        `${i + 1}. ${t.title} (confidence: ${t.confidence}) — ${t.summary} Cuts: ${t.direction}. Affects: ${t.affectedSectors.join(", ") || "broad market"}.`,
    )
    .join("\n");
}
