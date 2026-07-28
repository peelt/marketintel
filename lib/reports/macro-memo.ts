import { stripInlineMarkdown } from "@/lib/format";

/**
 * Parser for the Geopolitical desk's macro-read memo (composed by
 * lib/agents/geopolitical/agent.ts). The memo is persisted as markdown, but
 * the report page wants to render it as accordions — theme title + confidence
 * + "which way it cuts" always visible, the descriptive paragraph on expand —
 * so a reader gets the shape of the backdrop AND the ranked table above the
 * fold.
 *
 * This parses OUR OWN known output; if the shape ever drifts and a memo does
 * not parse into themes, callers fall back to rendering the raw markdown, so
 * nothing is ever lost.
 */

export interface MacroTheme {
  title: string;
  confidence: string | null;
  /** The descriptive paragraph(s), plain text. */
  summary: string;
  /** The "which way it cuts" line, plain text (bold label + emphasis stripped). */
  cuts: string | null;
}

export interface MacroMemoSource {
  label: string;
  url: string;
}

export interface ParsedMacroMemo {
  /** The italic "as of …" snapshot note, underscores stripped. */
  intro: string | null;
  themes: MacroTheme[];
  sources: MacroMemoSource[];
  /** Raw markdown of the "How this is scored" section body, if present. */
  scoringMarkdown: string | null;
}

const THEME_HEAD = /^###\s+(.+?)\s*·\s*confidence:\s*([A-Za-z]+)\s*$/;
const CUTS = /^\*\*Which way it cuts:\*\*\s*(.*)$/;
const SOURCES = /^\*\*Sources:\*\*\s*(.*)$/;
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

/**
 * Returns the structured memo, or null when the text isn't a macro memo at all
 * (no "## Macro read" section) or yields no themes — callers then render the
 * raw markdown unchanged.
 */
export function parseMacroMemo(markdown: string): ParsedMacroMemo | null {
  const lines = markdown.split("\n");
  const macroIdx = lines.findIndex((l) => /^##\s+Macro read\s*$/.test(l));
  if (macroIdx === -1) return null;

  let intro: string | null = null;
  const themes: MacroTheme[] = [];
  const sources: MacroMemoSource[] = [];
  let scoringMarkdown: string | null = null;

  let i = macroIdx + 1;
  // The italic snapshot note is the first non-empty line under "## Macro read".
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const em = /^_(.+)_$/.exec(t);
    if (em) intro = em[1].trim();
    break;
  }

  let current: MacroTheme | null = null;
  const pushCurrent = () => {
    if (current) {
      current.summary = current.summary.trim();
      themes.push(current);
      current = null;
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // A new section header ends the macro read.
    if (/^##\s+How this is scored\s*$/.test(trimmed)) {
      pushCurrent();
      // Stop at the NEXT top-level section rather than running to the end of
      // the document: Reaction embeds its macro read in a longer report whose
      // verdicts follow, and those are already rendered structurally above.
      const rest = lines.slice(i + 1);
      const nextSection = rest.findIndex((l) => /^##\s+\S/.test(l.trim()));
      scoringMarkdown = (nextSection === -1 ? rest : rest.slice(0, nextSection))
        .join("\n")
        .trim();
      break;
    }

    const head = THEME_HEAD.exec(trimmed);
    if (head) {
      pushCurrent();
      current = {
        title: head[1].trim(),
        confidence: head[2].toLowerCase(),
        summary: "",
        cuts: null,
      };
      continue;
    }

    const cuts = CUTS.exec(trimmed);
    if (cuts && current) {
      current.cuts = stripInlineMarkdown(cuts[1]).trim();
      continue;
    }

    const src = SOURCES.exec(trimmed);
    if (src) {
      pushCurrent();
      let m: RegExpExecArray | null;
      LINK.lastIndex = 0;
      while ((m = LINK.exec(src[1])) !== null) {
        sources.push({ label: m[1].trim(), url: m[2].trim() });
      }
      continue;
    }

    // Otherwise it's body text for the current theme.
    if (current && trimmed) {
      current.summary += (current.summary ? " " : "") + trimmed;
    }
  }
  pushCurrent();

  if (themes.length === 0) return null;
  return { intro, themes, sources, scoringMarkdown: scoringMarkdown || null };
}

/**
 * Pull the drop-attribution roll-up out of a Reaction summary — "3 of 9 graded
 * drop(s) trace to the macro backdrop — most to X (2)…".
 *
 * The agent emits it as the LAST sentence of summary_markdown (see
 * `summariseDrivers`), and the report page assembles itself from structured
 * data rather than rendering that markdown, so without this the line is
 * written every run and never seen. It belongs on the macro strip: it answers
 * "is this one story or many?" exactly where the themes are.
 *
 * Parses our own known output and returns null when the shape isn't there —
 * runs with no macro read produce no roll-up at all.
 */
export function extractDriverLine(summaryMarkdown: string): string | null {
  const m = /(?:All \d+ graded drop|\d+ of \d+ graded drop)[\s\S]*$/.exec(
    summaryMarkdown,
  );
  return m ? stripInlineMarkdown(m[0]).trim() || null : null;
}

/** Confidence → traffic-light colour for the small memo pill. */
export function confidenceColor(confidence: string | null): string {
  switch (confidence) {
    case "high":
      return "#22a87b";
    case "medium":
    case "moderate":
      return "#f6881c";
    case "low":
      return "#ee1d23";
    default:
      return "#6b7280";
  }
}
