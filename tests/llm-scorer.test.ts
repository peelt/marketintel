import { describe, expect, it } from "vitest";
import { validateGrade } from "@/lib/scoring/llm-scorer";

describe("validateGrade", () => {
  it("accepts a well-formed grade and rounds the score", () => {
    expect(
      validateGrade(
        JSON.stringify({ score: 72.6, justification: "solid coverage", confidence: "high" }),
      ),
    ).toEqual({ score: 73, justification: "solid coverage", confidence: "high" });
  });

  it("rejects out-of-range scores", () => {
    expect(
      validateGrade(JSON.stringify({ score: 140, justification: "x", confidence: "low" })),
    ).toBeNull();
    expect(
      validateGrade(JSON.stringify({ score: -5, justification: "x", confidence: "low" })),
    ).toBeNull();
  });

  it("rejects an unknown confidence value", () => {
    expect(
      validateGrade(JSON.stringify({ score: 50, justification: "x", confidence: "certain" })),
    ).toBeNull();
  });

  it("rejects non-JSON — no prose/regex fallback that could grab '30' from 'down 30%'", () => {
    expect(validateGrade("The stock is down 30% but fundamentals are intact.")).toBeNull();
  });

  it("rejects non-object JSON", () => {
    expect(validateGrade("42")).toBeNull();
    expect(validateGrade("null")).toBeNull();
  });
});
