import { getAnthropicClient, modelForTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";

/**
 * The Geopolitical desk's MACRO READ — one fresh web-research call per run
 * that surveys the current geopolitical backdrop and returns a small set of
 * named themes, each with an explicit confidence level and the sectors it
 * bears on. This is the memo shown above the ranked table, AND the shared
 * context every per-name exposure grade is anchored to — so "positioning" is
 * always measured against THIS week's themes, not a stale generic backdrop.
 *
 * Fresh every run (geopolitics moves weekly), so it is deliberately NOT
 * cached. Failure contract: null after one retry — the run then scores names
 * against no themes and says so, rather than inventing a backdrop.
 * Language discipline (I2): describes the world and sector exposure, never a
 * reader's holdings or any market call.
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
        "3-6 of the most consequential CURRENT geopolitical themes for markets, most consequential first.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short theme name, e.g. 'Advanced-semiconductor export controls'.",
          },
          summary: {
            type: "string",
            description:
              "2-3 sentences on what is happening right now and why it matters for the named sectors. Factual and impersonal.",
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
            description:
              "Confidence that this theme is real and material right now: high = well-documented and active; low = emerging or speculative.",
          },
          direction: {
            type: "string",
            description:
              "One phrase on which way it cuts, e.g. 'tailwind for domestic defense, headwind for China-exposed chipmakers'.",
          },
          affected_sectors: {
            type: "array",
            items: { type: "string" },
            description:
              "Sectors/themes this bears on, drawn from: defense, semiconductors, energy, critical minerals, agriculture, shipping, china-exposed tech.",
          },
        },
        required: ["title", "summary", "confidence", "direction", "affected_sectors"],
        additionalProperties: false,
      },
    },
    as_of_note: {
      type: "string",
      description:
        "One sentence framing the read as a snapshot of the current backdrop with its inherent uncertainty.",
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

const SYSTEM_PROMPT = `You are a geopolitical analyst briefing an investment-research desk. Survey the CURRENT geopolitical backdrop and identify the themes most material to markets right now.

Discipline:
- Report what is actually happening, with explicit confidence per theme. Prefer well-documented, active developments over speculation.
- Tie each theme to the sectors it bears on. Be specific about which way it cuts (beneficiaries vs. those at risk).
- Describe the world and sector-level exposure. NEVER give a market call, price target, or any instruction to a reader. No "buy"/"sell"/"investors should".`;

export async function researchMacroRead(asOf: string): Promise<MacroRead | null> {
  const first = await attemptMacro(asOf);
  if (first) return first;
  console.warn("researchMacroRead: retrying after empty result");
  return attemptMacro(asOf);
}

async function attemptMacro(asOf: string): Promise<MacroRead | null> {
  const client = getAnthropicClient();
  const userPrompt = `As of ${asOf}, research the current geopolitical backdrop and return the most market-material themes per the discipline.`;

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

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      console.error(`researchMacroRead: unusable stop_reason=${response.stop_reason}`);
      return null;
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseMacroRead(textBlock.text);
  } catch (err) {
    console.error(`researchMacroRead failed: ${getErrorMessage(err)}`);
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
    // Schema asks for 3–6 themes; enforce the ceiling the model was told
    // about. Every theme is injected into ~38 per-name prompts, so an
    // over-long list is token bloat plus low-signal themes entering the
    // ranking anchor. Keep the most-consequential (model returns them first).
    const cappedThemes = themes.slice(0, 6);
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
    return { themes: cappedThemes, asOfNote: c.as_of_note, sources };
  } catch {
    return null;
  }
}

/** Compact themes block for the per-name exposure prompt. */
export function themesForPrompt(read: MacroRead): string {
  return read.themes
    .map(
      (t, i) =>
        `${i + 1}. ${t.title} (confidence: ${t.confidence}) — ${t.summary} Cuts: ${t.direction}. Sectors: ${t.affectedSectors.join(", ") || "broad"}.`,
    )
    .join("\n");
}
