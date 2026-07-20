import { describe, expect, it } from "vitest";
import { parseMacroMemo, confidenceColor } from "@/lib/reports/macro-memo";

/**
 * The parser consumes the Geopolitical desk's OWN composed memo. This pins the
 * exact shape lib/agents/geopolitical/agent.ts emits so a format drift is
 * caught here rather than silently falling back to a wall of text in prod.
 */

const MEMO = [
  `# Geopolitical Scanner`,
  ``,
  `## Macro read`,
  ``,
  `_This is a snapshot of the geopolitical backdrop as of July 18, 2026; fluid._`,
  ``,
  `### US-Iran conflict and Strait of Hormuz disruption  ·  confidence: high`,
  ``,
  `The ceasefire broke down around July 8-11, 2026, following Iranian strikes.`,
  ``,
  `**Which way it cuts:** tailwind for energy prices; headwind for shipping  ·  _energy, shipping, defense_`,
  ``,
  `### US tariff regime in flux  ·  confidence: high`,
  ``,
  `Following the February 2026 Supreme Court ruling that IEEPA tariffs were unconstitutional.`,
  ``,
  `**Which way it cuts:** headwind for import-dependent manufacturers  ·  _china-exposed tech_`,
  ``,
  `**Sources:** [reuters.com](https://reuters.com/x) · [ft.com](https://ft.com/y)`,
  ``,
  `## How this is scored`,
  ``,
  `Framework v1 weighs positioning (50%), resilience (30%), materiality (20%).`,
  ``,
  `This run: 15 positioned to benefit, 1 at risk.`,
].join("\n");

describe("parseMacroMemo", () => {
  it("extracts the snapshot note, themes, sources and scoring", () => {
    const parsed = parseMacroMemo(MEMO)!;
    expect(parsed).not.toBeNull();

    expect(parsed.intro).toBe(
      "This is a snapshot of the geopolitical backdrop as of July 18, 2026; fluid.",
    );

    expect(parsed.themes).toHaveLength(2);
    expect(parsed.themes[0].title).toBe(
      "US-Iran conflict and Strait of Hormuz disruption",
    );
    expect(parsed.themes[0].confidence).toBe("high");
    expect(parsed.themes[0].summary).toContain("ceasefire broke down");
    // The "which way it cuts" line is captured with markdown emphasis stripped.
    expect(parsed.themes[0].cuts).toContain("tailwind for energy prices");
    expect(parsed.themes[0].cuts).toContain("energy, shipping, defense");
    expect(parsed.themes[0].cuts).not.toContain("_");
    expect(parsed.themes[0].cuts).not.toContain("*");

    expect(parsed.sources).toEqual([
      { label: "reuters.com", url: "https://reuters.com/x" },
      { label: "ft.com", url: "https://ft.com/y" },
    ]);

    expect(parsed.scoringMarkdown).toContain("Framework v1 weighs");
    expect(parsed.scoringMarkdown).toContain("This run: 15 positioned");
    // A theme's summary never bleeds into the next theme or the scoring block.
    expect(parsed.themes[1].summary).not.toContain("Framework v1");
  });

  it("returns null for a non-memo body (other desks) so callers fall back", () => {
    expect(parseMacroMemo("# Dividend Intelligence\n\nSome prose.")).toBeNull();
    expect(parseMacroMemo("## Macro read\n\nNo themes here.")).toBeNull();
  });

  it("maps confidence to a traffic-light colour", () => {
    expect(confidenceColor("high")).toBe("#22a87b");
    expect(confidenceColor("low")).toBe("#ee1d23");
    expect(confidenceColor(null)).toBe("#6b7280");
  });
});
