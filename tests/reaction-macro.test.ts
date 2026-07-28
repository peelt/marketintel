import { describe, expect, it } from "vitest";
import { parseMacroRead, themesForPrompt } from "@/lib/agents/reaction/macro";
import {
  describeMacroDriver,
  parseGrade,
  resolveMacroTheme,
  type ReactionNewsGrade,
} from "@/lib/agents/reaction/news";
import { summariseDrivers } from "@/lib/agents/reaction/agent";
import { parseMacroMemo } from "@/lib/reports/macro-memo";

/**
 * Reaction's macro layer — the rebuilt half of the retired Geopolitical desk.
 * The layer is CONTEXT, not a scored signal, so what these tests pin is the
 * honesty of the plumbing: an attribution is only recorded when a real
 * backdrop was supplied, an invented theme never reaches evidence, and a
 * failed read reads as "not asked" rather than "company-specific".
 */

const THEME = {
  title: "Advanced-semiconductor export controls",
  summary: "New licensing rules were published on 21 July.",
  confidence: "high",
  direction: "pressure on China-exposed chipmakers",
  affected_sectors: ["semiconductors"],
};

describe("macro read parsing", () => {
  const validRead = {
    themes: [THEME],
    as_of_note: "A snapshot of the backdrop as of 26 July 2026; fluid.",
    sources: [{ url: "https://example.com/a", title: "Report" }],
  };

  it("accepts a well-formed read", () => {
    const read = parseMacroRead(JSON.stringify(validRead));
    expect(read).not.toBeNull();
    expect(read!.themes).toHaveLength(1);
    expect(read!.themes[0].title).toBe(THEME.title);
    expect(read!.themes[0].affectedSectors).toEqual(["semiconductors"]);
    expect(read!.sources).toHaveLength(1);
  });

  it("caps the theme list at the ceiling the model was given", () => {
    const many = {
      ...validRead,
      themes: Array.from({ length: 9 }, (_, i) => ({
        ...THEME,
        title: `Theme ${i}`,
      })),
    };
    expect(parseMacroRead(JSON.stringify(many))!.themes).toHaveLength(5);
  });

  it("drops malformed themes and returns null when none survive", () => {
    const mixed = {
      ...validRead,
      themes: [THEME, { ...THEME, confidence: "certain" }, { title: "bare" }],
    };
    expect(parseMacroRead(JSON.stringify(mixed))!.themes).toHaveLength(1);

    expect(parseMacroRead(JSON.stringify({ ...validRead, themes: [] }))).toBeNull();
    expect(parseMacroRead("the world is complicated today")).toBeNull();
  });

  it("numbers themes in the prompt block so titles can be echoed back", () => {
    const block = themesForPrompt(parseMacroRead(JSON.stringify(validRead))!);
    expect(block).toContain(`1. ${THEME.title}`);
    expect(block).toContain("confidence: high");
    expect(block).toContain("semiconductors");
  });
});

describe("macro theme resolution", () => {
  const titles = ["Advanced-semiconductor export controls", "UK gilt repricing"];

  it("matches exactly and case-insensitively", () => {
    expect(resolveMacroTheme("UK gilt repricing", titles)).toBe("UK gilt repricing");
    expect(resolveMacroTheme("  uk GILT repricing ", titles)).toBe("UK gilt repricing");
  });

  it("matches a lightly reworded title by containment", () => {
    expect(resolveMacroTheme("export controls", titles)).toBe(titles[0]);
  });

  it("returns null for an invented theme or no answer", () => {
    expect(resolveMacroTheme("Martian tariff regime", titles)).toBeNull();
    expect(resolveMacroTheme("", titles)).toBeNull();
    expect(resolveMacroTheme(null, titles)).toBeNull();
    expect(resolveMacroTheme("anything", [])).toBeNull();
  });
});

describe("news grade attribution", () => {
  const base = {
    damage_severity: 35,
    disproportion: 78,
    headline: "Guidance trimmed on FX headwinds",
    summary: "The company cut FY guidance by 3% on currency effects.",
    sources: [{ url: "https://example.com/a", title: "Report" }],
    confidence: "high",
  };
  const titles = [THEME.title];

  it("records the driver and theme when a real backdrop was supplied", () => {
    const g = parseGrade(
      JSON.stringify({
        ...base,
        macro_driver: "macro_driven",
        macro_theme: THEME.title,
      }),
      titles,
    );
    expect(g!.macroDriver).toBe("macro_driven");
    expect(g!.macroTheme).toBe(THEME.title);
  });

  it("records unattributed when there was no macro read, whatever the model said", () => {
    const g = parseGrade(
      JSON.stringify({
        ...base,
        macro_driver: "macro_driven",
        macro_theme: THEME.title,
      }),
      [],
    );
    // A failed read must not become a finding: "we never asked" is not
    // "the drop was company-specific", and it isn't macro-driven either.
    expect(g!.macroDriver).toBe("unattributed");
    expect(g!.macroTheme).toBeNull();
  });

  it("falls back to idiosyncratic when the echoed theme isn't in the backdrop", () => {
    const g = parseGrade(
      JSON.stringify({
        ...base,
        macro_driver: "macro_driven",
        macro_theme: "A theme nobody researched",
      }),
      titles,
    );
    expect(g!.macroDriver).toBe("idiosyncratic");
    expect(g!.macroTheme).toBeNull();
  });

  it("keeps an idiosyncratic answer theme-less and ignores a stray theme", () => {
    const g = parseGrade(
      JSON.stringify({
        ...base,
        macro_driver: "idiosyncratic",
        macro_theme: THEME.title,
      }),
      titles,
    );
    expect(g!.macroDriver).toBe("idiosyncratic");
    expect(g!.macroTheme).toBeNull();
  });

  it("still parses a grade with no attribution fields at all", () => {
    const g = parseGrade(JSON.stringify(base), titles);
    expect(g).not.toBeNull();
    expect(g!.macroDriver).toBe("unattributed");
    expect(g!.damageSeverity).toBe(35);
  });

  it("labels drivers impersonally, and says nothing when unattributed", () => {
    expect(describeMacroDriver("macro_driven", THEME.title)).toBe(
      `macro-driven · ${THEME.title}`,
    );
    expect(describeMacroDriver("macro_amplified", null)).toBe("macro-amplified");
    expect(describeMacroDriver("idiosyncratic", null)).toBe("company-specific");
    expect(describeMacroDriver("unattributed", null)).toBeNull();
  });
});

describe("driver roll-up", () => {
  const grade = (
    macroDriver: ReactionNewsGrade["macroDriver"],
    macroTheme: string | null = null,
  ): ReactionNewsGrade => ({
    damageSeverity: 40,
    disproportion: 60,
    headline: "h",
    summary: "s",
    sources: [],
    confidence: "medium",
    corporateAction: "none",
    macroDriver,
    macroTheme,
  });

  it("says nothing when no name carried an attribution", () => {
    expect(summariseDrivers([])).toBeNull();
    expect(summariseDrivers([grade("unattributed"), grade("unattributed")])).toBeNull();
  });

  it("reports an all-company-specific run without naming a theme", () => {
    const line = summariseDrivers([grade("idiosyncratic"), grade("idiosyncratic")]);
    expect(line).toBe(
      "All 2 graded drop(s) trace to company-specific news, not the macro backdrop.",
    );
  });

  it("names the theme carrying the most drops and counts the macro-driven ones", () => {
    const line = summariseDrivers([
      grade("macro_driven", "Tariff escalation"),
      grade("macro_driven", "Tariff escalation"),
      grade("macro_amplified", "UK gilt repricing"),
      grade("idiosyncratic"),
      grade("unattributed"),
    ])!;
    // 4 attributed (the unattributed one is not counted), 3 of them macro.
    expect(line).toContain("3 of 4 graded drop(s) trace to the macro backdrop");
    expect(line).toContain("**Tariff escalation** (2)");
    expect(line).toContain("2 fell with little company-specific news");
  });

  it("stays impersonal", () => {
    const line = summariseDrivers([grade("macro_driven", "Tariff escalation")])!;
    for (const banned of ["you should", "your ", " buy ", " sell "]) {
      expect(line.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("reaction macro read renders through the memo parser", () => {
  // The layer reuses the retired desk's markdown shape so the existing theme
  // accordions render it for free — this pins that contract from Reaction's
  // side, where the memo is one section of a LONGER report.
  const BODY = [
    `# Reaction Analyser`,
    ``,
    `850 names screened; 3 cleared the drop threshold.`,
    ``,
    `## Macro read`,
    ``,
    `_A snapshot of the backdrop as of 26 July 2026; fluid._`,
    ``,
    `### ${THEME.title}  ·  confidence: high`,
    ``,
    THEME.summary,
    ``,
    `**Which way it cuts:** pressure on China-exposed chipmakers  ·  _semiconductors_`,
    ``,
    `**Sources:** [example.com](https://example.com/a)`,
    ``,
    `## How this is scored`,
    ``,
    `Inclusion: 5-session drawdown or 1-session drop past the thresholds.`,
    ``,
    `## Verdicts`,
    ``,
    `- **ACME** — strong overshoot (composite 80.0, coverage 100%, macro-driven · ${THEME.title}).`,
  ].join("\n");

  it("parses the embedded macro section into themes", () => {
    const memo = parseMacroMemo(BODY);
    expect(memo).not.toBeNull();
    expect(memo!.intro).toContain("26 July 2026");
    expect(memo!.themes).toHaveLength(1);
    expect(memo!.themes[0].title).toBe(THEME.title);
    expect(memo!.themes[0].confidence).toBe("high");
    expect(memo!.themes[0].cuts).toContain("China-exposed chipmakers");
    expect(memo!.sources).toHaveLength(1);
  });

  it("stops the scoring section at the next heading, not the end of the report", () => {
    const memo = parseMacroMemo(BODY)!;
    expect(memo.scoringMarkdown).toContain("Inclusion: 5-session drawdown");
    // Verdicts are rendered structurally above; repeating them inside the
    // "how this is scored" accordion would duplicate the whole report.
    expect(memo.scoringMarkdown).not.toContain("ACME");
    expect(memo.scoringMarkdown).not.toContain("## Verdicts");
  });

  it("returns null for a run whose macro read failed", () => {
    const noRead = BODY.replace(
      /## Macro read[\s\S]*?## How this is scored/,
      [
        `## Macro read`,
        ``,
        `_No macro read was available this run — each drop was researched on its own news, without a shared backdrop to attribute it against._`,
        ``,
        `## How this is scored`,
      ].join("\n"),
    );
    // No themes → no accordion; the page renders nothing rather than an
    // empty backdrop card.
    expect(parseMacroMemo(noRead)).toBeNull();
  });
});
