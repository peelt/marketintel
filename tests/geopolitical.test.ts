import { describe, expect, it } from "vitest";
import { classifyGeopolitical } from "@/lib/agents/geopolitical/metrics";
import { parseGeoExposure } from "@/lib/agents/geopolitical/research";
import { parseMacroRead, themesForPrompt } from "@/lib/agents/geopolitical/macro";
import { parseNewsEvidence } from "@/lib/format";
import type { CandidateScore } from "@/lib/scoring/types";

function scored(overrides: {
  coverage?: number;
  positioning?: number | null;
  resilience?: number | null;
  materiality?: number | null;
}): CandidateScore {
  const {
    coverage = 0.9,
    positioning = 60,
    resilience = 55,
    materiality = 60,
  } = overrides;
  const sig = (key: string, raw: number | null) => ({
    score: raw,
    signals: { [key]: { raw, normalised: raw, weight: 1 } },
  });
  return {
    securityId: "s1",
    composite: 50, // deliberately mid — the composite must NOT drive labels
    coverage,
    criteria: {
      positioning: sig("positioning_grade", positioning),
      resilience: sig("resilience_grade", resilience),
      materiality: sig("materiality_grade", materiality),
    },
    evidence: [],
  };
}

describe("classifyGeopolitical — absolute facts, never the blended composite", () => {
  it("withholds below the coverage floor", () => {
    const c = classifyGeopolitical(scored({ coverage: 0.2 }));
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("withheld");
  });

  it("withholds when positioning (the defining grade) is missing", () => {
    const c = classifyGeopolitical(
      scored({ positioning: null, resilience: null, materiality: null, coverage: 0.5 }),
    );
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("did not complete");
  });

  it("marks low-materiality names insulated regardless of positioning", () => {
    // Materiality gate fires before the positioning bands — a domestic name
    // geopolitics barely touches is never mislabelled a beneficiary/casualty.
    expect(classifyGeopolitical(scored({ materiality: 20, positioning: 80 })).classification).toBe(
      "insulated",
    );
    expect(classifyGeopolitical(scored({ materiality: 20, positioning: 10 })).classification).toBe(
      "insulated",
    );
  });

  it("beneficiary needs BOTH strong positioning and real materiality", () => {
    expect(classifyGeopolitical(scored({ positioning: 75, materiality: 70 })).classification).toBe(
      "beneficiary",
    );
    // Strong positioning but immaterial → insulated, not beneficiary.
    expect(classifyGeopolitical(scored({ positioning: 75, materiality: 25 })).classification).toBe(
      "insulated",
    );
  });

  it("at_risk needs weak positioning AND real materiality", () => {
    expect(classifyGeopolitical(scored({ positioning: 25, materiality: 70 })).classification).toBe(
      "at_risk",
    );
    // Weak-ish but mid materiality and mid positioning → mixed.
    expect(classifyGeopolitical(scored({ positioning: 50, materiality: 60 })).classification).toBe(
      "mixed",
    );
  });

  it("verdicts describe the company, never advise the reader (I2)", () => {
    for (const c of [
      classifyGeopolitical(scored({})),
      classifyGeopolitical(scored({ positioning: 75, materiality: 70 })),
      classifyGeopolitical(scored({ positioning: 20, materiality: 70 })),
      classifyGeopolitical(scored({ materiality: 15 })),
    ]) {
      expect(c.verdict.toLowerCase()).not.toMatch(/\b(you|your|buy|sell|should)\b/);
    }
  });
});

describe("parseGeoExposure", () => {
  const valid = {
    positioning_grade: 82,
    resilience_grade: 55,
    materiality_grade: 90,
    primary_theme: "Advanced-semiconductor export controls",
    headline: "A leading AI accelerator vendor at the centre of export-control policy.",
    summary: "The company sells advanced GPUs and faces China export limits.",
    confidence: "high",
  };

  it("parses a valid payload and rounds", () => {
    const e = parseGeoExposure(JSON.stringify({ ...valid, positioning_grade: 81.6 }))!;
    expect(e.positioningGrade).toBe(82);
    expect(e.materialityGrade).toBe(90);
    expect(e.primaryTheme).toContain("export controls");
  });

  it("rejects out-of-range grades and missing fields", () => {
    expect(parseGeoExposure(JSON.stringify({ ...valid, materiality_grade: 140 }))).toBeNull();
    const { resilience_grade: _dropped, ...missing } = valid;
    expect(parseGeoExposure(JSON.stringify(missing))).toBeNull();
    expect(parseGeoExposure("not json")).toBeNull();
  });
});

describe("parseMacroRead", () => {
  const valid = {
    themes: [
      {
        title: "Advanced-semiconductor export controls",
        summary: "Controls widened this quarter.",
        confidence: "high",
        direction: "tailwind for domestic equipment, headwind for China-exposed chipmakers",
        affected_sectors: ["semiconductors", "china-exposed tech"],
      },
    ],
    as_of_note: "A snapshot of a fast-moving backdrop.",
    sources: [{ url: "https://example.com/x", title: "Coverage" }],
  };

  it("parses themes with confidence and builds a prompt block", () => {
    const read = parseMacroRead(JSON.stringify(valid))!;
    expect(read.themes).toHaveLength(1);
    expect(read.themes[0].confidence).toBe("high");
    const block = themesForPrompt(read);
    expect(block).toContain("confidence: high");
    expect(block).toContain("export controls");
  });

  it("drops malformed themes and nulls out when none survive", () => {
    expect(parseMacroRead(JSON.stringify({ ...valid, themes: [] }))).toBeNull();
    expect(
      parseMacroRead(JSON.stringify({ ...valid, themes: [{ title: "x" }] })),
    ).toBeNull();
    expect(parseMacroRead("not json")).toBeNull();
  });
});

describe("geopolitical evidence card shape", () => {
  it("parses with the shared structured-evidence parser (report card rendering)", () => {
    const text =
      "[NVDA · positioning 82/100 · high] A leading AI accelerator vendor at the centre of export policy.\n\n" +
      "The company sells advanced GPUs and faces China export limits.\n\n" +
      "Primary theme: Advanced-semiconductor export controls";
    const parsed = parseNewsEvidence(text)!;
    expect(parsed.ticker).toBe("NVDA");
    expect(parsed.gradeLabel).toBe("positioning");
    expect(parsed.grade).toBe(82);
    expect(parsed.confidence).toBe("high");
  });
});
