import { describe, expect, it } from "vitest";
import { chunk, mapWithConcurrency } from "@/lib/concurrency";
import { matchPairs } from "@/lib/ingest/resolve-security";
import {
  buildUserPrompt,
  gradeTextToSignalValue,
  type LlmScoringRequest,
} from "@/lib/scoring/llm-scorer";

describe("mapWithConcurrency", () => {
  it("preserves input order in results", async () => {
    const out = await mapWithConcurrency([5, 1, 3], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 5)); // slowest first
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30]);
  });

  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // it actually ran concurrently
  });

  it("rejects on the first error instead of returning partial results", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("resolver broke");
        return n;
      }),
    ).rejects.toThrow("resolver broke");
  });

  it("handles empty input and rejects a nonsense limit", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    await expect(mapWithConcurrency([1], 0, async (x) => x)).rejects.toThrow();
  });
});

describe("chunk", () => {
  it("splits with a ragged tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 25)).toEqual([]);
  });

  it("covers an 800-name universe in serverless-sized steps", () => {
    const chunks = chunk(Array.from({ length: 800 }, (_, i) => i), 25);
    expect(chunks).toHaveLength(32);
    expect(chunks.flat()).toHaveLength(800);
  });
});

describe("matchPairs", () => {
  it("matches on ticker AND exchange — RIO on LSE is not RIO on NYSE", () => {
    const rows = [
      { id: "uuid-lse", ticker: "RIO", exchange: "LSE" },
      { id: "uuid-nyse", ticker: "RIO", exchange: "NYSE" },
    ];
    const out = matchPairs(rows, [
      { ticker: "RIO", exchange: "LSE" },
      { ticker: "RIO", exchange: "NYSE" },
      { ticker: "GONE", exchange: "NYSE" },
    ]);
    expect(out.get("RIO::LSE")).toBe("uuid-lse");
    expect(out.get("RIO::NYSE")).toBe("uuid-nyse");
    expect(out.get("GONE::NYSE")).toBeNull();
  });
});

describe("LLM grade → SignalValue mapping (shared by single and Batch API paths)", () => {
  const request: LlmScoringRequest = {
    criterion: "moat durability",
    rubric: "How defensible is the franchise?",
    context: "Evidence body",
    evidence: [
      {
        type: "news_article",
        sourceTable: "news_articles",
        sourceId: "3e0b1a52-0000-4000-8000-000000000001",
        text: "original evidence",
        weight: 0.8,
      },
    ],
  };

  it("maps a valid calibrated grade onto raw with annotated evidence", () => {
    const value = gradeTextToSignalValue(
      request,
      JSON.stringify({ score: 72, justification: "Strong switching costs.", confidence: "high" }),
    );
    expect(value.raw).toBe(72);
    expect(value.evidence[0].text).toContain("score 72");
    expect(value.evidence[0].text).toContain("original evidence");
  });

  it("returns a NULL signal (not zero) for malformed or out-of-range output", () => {
    for (const bad of [
      "not json at all",
      JSON.stringify({ score: 130, justification: "x", confidence: "high" }),
      JSON.stringify({ score: 50, justification: "x", confidence: "certain" }),
    ]) {
      const value = gradeTextToSignalValue(request, bad);
      expect(value.raw).toBeNull();
      expect(value.evidence).toEqual(request.evidence); // untouched passthrough
    }
  });

  it("caps prompt context at ~6000 chars so batch requests can't bloat", () => {
    const prompt = buildUserPrompt({ ...request, context: "y".repeat(20_000) });
    expect(prompt.length).toBeLessThan(6_500);
  });
});
