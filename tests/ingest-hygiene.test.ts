import { describe, expect, it } from "vitest";
import { dedupeBy } from "@/lib/ingest/dedupe";
import { collectPerTicker } from "@/lib/ingest/failure-report";
import { NotFoundError, RateLimitedError } from "@/lib/data-sources/errors";
import { suffixSymbol } from "@/lib/data-sources/symbols";
import {
  dividendUniverse,
  energyUniverse,
  metalsUniverse,
} from "@/lib/data-sources/universes";

describe("dedupeBy", () => {
  it("keeps the LAST occurrence per key — freshest report wins", () => {
    const rows = [
      { exDate: "2026-05-10", amount: 0.3 },
      { exDate: "2026-05-10", amount: 0.31 }, // re-reported with amount jitter
      { exDate: "2026-02-10", amount: 0.29 },
    ];
    const out = dedupeBy(rows, (r) => r.exDate);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.exDate === "2026-05-10")!.amount).toBe(0.31);
  });

  it("is a no-op on already-unique batches", () => {
    const rows = [{ k: "a" }, { k: "b" }];
    expect(dedupeBy(rows, (r) => r.k)).toEqual(rows);
  });
});

describe("collectPerTicker", () => {
  it("records typed failures per ticker and keeps the run going", async () => {
    const seeds = [
      { ticker: "AAA", exchange: "NYSE" },
      { ticker: "GONE", exchange: "NYSE" },
      { ticker: "BUSY", exchange: "LSE" },
    ];
    const { rows, report } = await collectPerTicker("prices", seeds, async (s) => {
      if (s.ticker === "GONE") throw new NotFoundError("finnhub", "delisted");
      if (s.ticker === "BUSY") throw new RateLimitedError("finnhub", "429");
      return [{ ticker: s.ticker, close: 1 }];
    });

    expect(rows).toHaveLength(1);
    expect(report).toMatchObject({ attempted: 3, succeeded: 1, failed: 2 });
    expect(report.failures).toEqual([
      expect.objectContaining({ ticker: "GONE", kind: "not_found" }),
      expect.objectContaining({ ticker: "BUSY", kind: "rate_limited" }),
    ]);
  });

  it("classifies untyped throws as unknown instead of losing them", async () => {
    const { report } = await collectPerTicker(
      "fundamentals",
      [{ ticker: "X", exchange: "NYSE" }],
      async () => {
        throw new Error("boom");
      },
    );
    expect(report.failures[0]).toMatchObject({ kind: "unknown", reason: "boom" });
  });
});

describe("suffixSymbol", () => {
  it("maps exchanges to provider suffixes", () => {
    expect(suffixSymbol("HSBA", "LSE")).toBe("HSBA.L");
    expect(suffixSymbol("RY", "TSX")).toBe("RY.TO");
    expect(suffixSymbol("AAPL", "NASDAQ")).toBe("AAPL");
  });

  it("strips trailing dots before suffixing (Aviva is 'AV.' on the LSE)", () => {
    expect(suffixSymbol("AV.", "LSE")).toBe("AV.L");
  });
});

describe("seed universes", () => {
  it("parse against the schema and carry the 2026-07 review", () => {
    for (const u of [dividendUniverse, energyUniverse, metalsUniverse]) {
      expect(u._meta.version).toBeGreaterThanOrEqual(2);
      expect(u._meta.last_reviewed).toBe("2026-07-14");
    }
  });

  it("no longer contain names delisted or renamed before the review date", () => {
    const all = [
      ...dividendUniverse.securities,
      ...energyUniverse.securities,
      ...metalsUniverse.securities,
    ].map((s) => `${s.ticker}:${s.exchange}`);

    for (const gone of ["WBA:NASDAQ", "MRO:NYSE", "HES:NYSE", "SWN:NYSE", "CHK:NASDAQ", "GOLD:NYSE", "EVR:LSE", "SAND:NYSE"]) {
      expect(all).not.toContain(gone);
    }
    // renames landed
    expect(all).toContain("EXE:NASDAQ");
    expect(all).toContain("B:NYSE");
  });
});
