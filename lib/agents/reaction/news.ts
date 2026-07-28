import { getAnthropicClient, modelForTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";
import { themesForPrompt, type MacroRead } from "./macro";

/**
 * News layer for the Reaction Analyser: one routine-tier call per screened
 * name, with the native web_search server tool and structured outputs. (Runs
 * on the routine model since the cost-control pass — was "deep" before.)
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
 * When the run's macro layer (macro.ts) produced a backdrop, the themes are
 * injected here and the call ALSO attributes the drop: idiosyncratic, macro
 * amplified, or macro driven. That attribution is context, not a score — it
 * informs the two grades the model already returns (a name that fell with its
 * whole sector on a policy shock, with nothing new of its own, is the classic
 * overshoot) rather than adding a framework signal. No extra API call: the
 * whole macro layer costs one run-level research call plus a longer prompt.
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
  /**
   * The run's backdrop, or null when the macro read failed — in which case the
   * drop is NOT asked to be attributed at all, rather than being asked against
   * an empty backdrop and defaulting every name to "idiosyncratic". Passed
   * whole (not as a pre-rendered block) so the prompt the model sees and the
   * titles its answer is validated against can never disagree.
   */
  macro?: MacroRead | null;
}

/**
 * How much of the drop the identified cause is specific to this company.
 * `unattributed` is not a model output — it is what the pipeline records when
 * there was no macro read to attribute against.
 */
export type MacroDriver =
  | "idiosyncratic"
  | "macro_amplified"
  | "macro_driven"
  | "unattributed";

/**
 * Whether the screened fall is a corporate action / data artefact rather than
 * a loss of value. An "overshoot" claim presupposes the price move was REAL —
 * a 10-for-1 split reads as a -90% drop against near-zero news damage, which
 * is the maximum-disproportion shape, so without this the artefact tops the
 * ranking. Anything but "none" is excluded from the ranking (see the agent).
 */
export type CorporateActionFlag = "none" | "suspected" | "confirmed";

export interface ReactionNewsGrade {
  damageSeverity: number;
  disproportion: number;
  headline: string;
  summary: string;
  sources: { url: string; title: string }[];
  confidence: "low" | "medium" | "high";
  corporateAction: CorporateActionFlag;
  /** `unattributed` whenever the run had no macro read. */
  macroDriver: MacroDriver;
  /**
   * The macro theme this drop was attributed to, matched back to a REAL theme
   * title from the run's read; null when idiosyncratic, unattributed, or when
   * the model echoed a title that isn't in the backdrop it was given.
   */
  macroTheme: string | null;
}

const BASE_PROPERTIES = {
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
  corporate_action: {
    type: "string",
    enum: ["none", "suspected", "confirmed"],
    description:
      "Whether the screened fall is a CORPORATE ACTION or data artefact rather than a loss of value: a share split or subdivision, consolidation/reverse split, demerger or spin-off, a large special dividend going ex, a redenomination, or a price series that mixes pre- and post-action closes. 'confirmed' = the action is documented and dated in the sources; 'suspected' = the pattern fits (e.g. a fall very close to an exact ratio such as -90% or -50%, with no news to explain it) but no source confirms it; 'none' = the shares genuinely fell.",
  },
} as const;

const MACRO_PROPERTIES = {
  macro_driver: {
    type: "string",
    enum: ["idiosyncratic", "macro_amplified", "macro_driven"],
    description:
      "How much of this drop is specific to THIS company. 'idiosyncratic' = company-specific news (earnings miss, guidance cut, litigation, management change) — the default unless the macro evidence is clear; 'macro_amplified' = real company-specific news, but one of the listed themes deepened the move; 'macro_driven' = little or no company-specific news, the name fell with its sector or the market on a listed theme.",
  },
  macro_theme: {
    type: "string",
    description:
      "When macro_driver is not 'idiosyncratic', the title of the listed theme this drop is attributed to, copied VERBATIM from the list provided. Empty string when idiosyncratic. Never invent a theme that is not on the list.",
  },
} as const;

const BASE_REQUIRED = [
  "damage_severity",
  "disproportion",
  "headline",
  "summary",
  "sources",
  "confidence",
  "corporate_action",
] as const;

const GRADE_SCHEMA = {
  type: "object",
  properties: BASE_PROPERTIES,
  required: BASE_REQUIRED,
  additionalProperties: false,
} as const;

/**
 * Used only when the run HAS a macro read. With no backdrop to attribute
 * against, asking the question anyway would force a required field the model
 * could only answer "idiosyncratic" to — manufacturing a finding out of a
 * failed research call.
 */
const GRADE_SCHEMA_WITH_MACRO = {
  type: "object",
  properties: { ...BASE_PROPERTIES, ...MACRO_PROPERTIES },
  required: [...BASE_REQUIRED, "macro_driver", "macro_theme"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a buy-side event analyst. A stock has just fallen sharply; your job is to identify WHY from current news and grade two things on absolute 0-100 scales: how much real fundamental damage the cause implies, and how disproportionate the price move is given that cause.

Discipline:
- Search for and rely on concrete, current reporting. Cite what you used.
- Grades are ABSOLUTE (calibrated across all stocks and time), not relative to today's screen.
- If you cannot identify a credible cause, say so: damage_severity near 50, confidence "low", and a summary stating that no clear cause was found.
- FIRST, check whether the shares actually fell. A very large drop with no matching news is usually a corporate action — a split, consolidation, demerger or large special dividend — showing up in an unadjusted price series, not a loss of value. Check the company's own announcements for the dates involved before grading damage.
- Describe the security and the move. Never address any reader's holdings, decisions, or circumstances; no recommendations.`;

/**
 * Appended only when a backdrop is supplied. Attribution is deliberately
 * conservative: a name falling on the same day as a macro theme is not
 * evidence it fell BECAUSE of it, and a wrong attribution would explain away
 * real company-specific damage as market noise — the exact error that turns an
 * earned decline into a false overshoot call.
 */
const MACRO_DISCIPLINE = `
Attribution:
- You are given the macro themes currently moving prices. Judge how much of THIS drop is company-specific.
- Attribute to a theme only when the reporting supports it — the name's sector visibly moved on that theme, or the coverage of this drop names it. Coincident timing alone is not evidence.
- Default to "idiosyncratic". Attributing a company-specific decline to the macro backdrop would understate real damage.
- A drop that is largely macro-driven with little company-specific news usually implies LOWER damage_severity: the news about this company is thin, whatever the market did to its price.`;

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
  const macro = request.macro?.themes.length ? request.macro : null;
  const themesBlock = macro ? themesForPrompt(macro) : null;
  const userPrompt = `Security: ${request.name} (${request.ticker}, ${request.exchange})
As of ${request.asOf}, the shares are down ${pct(request.return1d)} over 1 trading day and ${pct(request.return5d)} over 5 trading days.
${
  themesBlock
    ? `
Macro themes currently moving prices:
${themesBlock}
`
    : ""
}
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
        format: {
          type: "json_schema",
          schema: themesBlock ? GRADE_SCHEMA_WITH_MACRO : GRADE_SCHEMA,
        },
      },
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
      ],
      system: themesBlock ? `${SYSTEM_PROMPT}\n${MACRO_DISCIPLINE}` : SYSTEM_PROMPT,
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
    return parseGrade(
      textBlock.text,
      macro ? macro.themes.map((t) => t.title) : [],
    );
  } catch (err) {
    console.error(
      `gradeReactionNews failed for ${request.ticker}: ${getErrorMessage(err)}`,
    );
    return null;
  }
}

/**
 * Match the model's echoed theme title back to a REAL theme from the run's
 * backdrop — case- and whitespace-insensitive, with a contains-fallback for a
 * lightly reworded title. Returns null when nothing matches, so an invented
 * theme is dropped rather than persisted as evidence. Pure; exported for tests.
 */
export function resolveMacroTheme(
  echoed: string | null | undefined,
  themeTitles: string[],
): string | null {
  const needle = echoed?.trim().toLowerCase();
  if (!needle) return null;
  const exact = themeTitles.find((t) => t.trim().toLowerCase() === needle);
  if (exact) return exact;
  return (
    themeTitles.find((t) => {
      const hay = t.trim().toLowerCase();
      return hay.includes(needle) || needle.includes(hay);
    }) ?? null
  );
}

/**
 * Defensive parse — exported for tests. Ranges aren't schema-expressible.
 *
 * `themeTitles` is the run's real backdrop; pass it whenever the call was made
 * WITH a macro read. Omitted (or empty), attribution is recorded as
 * `unattributed` — the honest reading of "we never asked".
 */
export function parseGrade(
  text: string,
  themeTitles: string[] = [],
): ReactionNewsGrade | null {
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

    // Attribution is only meaningful when a backdrop was supplied. A driver
    // that isn't one of the three known values is discarded rather than
    // guessed at, and a macro driver that resolves to no real theme falls back
    // to idiosyncratic with no theme attached.
    const driver =
      themeTitles.length > 0 &&
      (c.macro_driver === "idiosyncratic" ||
        c.macro_driver === "macro_amplified" ||
        c.macro_driver === "macro_driven")
        ? c.macro_driver
        : "unattributed";
    const claimsMacro = driver === "macro_amplified" || driver === "macro_driven";
    const theme = claimsMacro
      ? resolveMacroTheme(
          typeof c.macro_theme === "string" ? c.macro_theme : null,
          themeTitles,
        )
      : null;
    // A macro claim that names no real theme is not a macro finding.
    const resolvedDriver = claimsMacro && theme === null ? "idiosyncratic" : driver;

    // Unknown/absent → "none": the flag must be positively asserted before it
    // pulls a name out of the ranking.
    const corporateAction: CorporateActionFlag =
      c.corporate_action === "confirmed" || c.corporate_action === "suspected"
        ? c.corporate_action
        : "none";

    return {
      damageSeverity: Math.round(c.damage_severity),
      disproportion: Math.round(c.disproportion),
      headline: c.headline,
      summary: c.summary,
      sources,
      confidence: c.confidence,
      corporateAction,
      macroDriver: resolvedDriver,
      macroTheme: theme,
    };
  } catch {
    return null;
  }
}

/** Plain-English label for a driver, for report lines. */
export function describeMacroDriver(
  driver: MacroDriver,
  theme: string | null,
): string | null {
  switch (driver) {
    case "macro_driven":
      return theme ? `macro-driven · ${theme}` : "macro-driven";
    case "macro_amplified":
      return theme ? `macro-amplified · ${theme}` : "macro-amplified";
    case "idiosyncratic":
      return "company-specific";
    case "unattributed":
      return null;
  }
}

export function confidenceWeight(confidence: "low" | "medium" | "high"): number {
  return confidence === "high" ? 0.9 : confidence === "medium" ? 0.6 : 0.3;
}
