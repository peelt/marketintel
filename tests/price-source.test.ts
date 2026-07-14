import { describe, expect, it } from "vitest";
import {
  withFallback,
  assertReady,
  type PriceSource,
  type FallbackEvent,
} from "@/lib/data-sources/price-source";
import {
  DataSourceError,
  NotConfiguredError,
  NotFoundError,
  RateLimitedError,
} from "@/lib/data-sources/errors";
import type { RawPriceSnapshot } from "@/lib/data-sources/types";

const QUERY = { ticker: "HSBA", exchange: "LSE", from: "2026-01-01", to: "2026-07-01" };

function snapshot(source: "finnhub" | "yfinance"): RawPriceSnapshot {
  return {
    ticker: "HSBA",
    exchange: "LSE",
    snapshotDate: "2026-06-30",
    close: 700,
    currency: "GBp",
    source,
  };
}

function stubSource(overrides: Partial<PriceSource>): PriceSource {
  return {
    name: "finnhub",
    readiness: () => null,
    fetchPrices: async () => [snapshot("finnhub")],
    fetchDividends: async () => [],
    fetchFundamentals: async () => null,
    ...overrides,
  };
}

describe("withFallback", () => {
  it("returns the primary's result when the primary succeeds", async () => {
    const events: FallbackEvent[] = [];
    const source = withFallback(
      stubSource({}),
      stubSource({ name: "yfinance", fetchPrices: async () => [snapshot("yfinance")] }),
      (e) => events.push(e),
    );
    const rows = await source.fetchPrices(QUERY);
    expect(rows[0].source).toBe("finnhub");
    expect(events).toHaveLength(0);
  });

  it("falls back on a typed primary failure and reports the event", async () => {
    const events: FallbackEvent[] = [];
    const source = withFallback(
      stubSource({
        fetchPrices: async () => {
          throw new NotFoundError("finnhub", "symbol HSBA.L unknown to provider");
        },
      }),
      stubSource({ name: "yfinance", fetchPrices: async () => [snapshot("yfinance")] }),
      (e) => events.push(e),
    );
    const rows = await source.fetchPrices(QUERY);
    expect(rows[0].source).toBe("yfinance");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      primary: "finnhub",
      fallback: "yfinance",
      method: "fetchPrices",
      ticker: "HSBA",
      kind: "not_found",
    });
  });

  it("falls back on untyped failures too, reporting kind unknown", async () => {
    const events: FallbackEvent[] = [];
    const source = withFallback(
      stubSource({
        fetchDividends: async () => {
          throw new Error("socket hang up");
        },
      }),
      stubSource({ name: "yfinance" }),
      (e) => events.push(e),
    );
    await source.fetchDividends(QUERY);
    expect(events[0].kind).toBe("unknown");
  });

  it("propagates the fallback's error when both sources fail", async () => {
    const source = withFallback(
      stubSource({
        fetchPrices: async () => {
          throw new RateLimitedError("finnhub", "429");
        },
      }),
      stubSource({
        name: "yfinance",
        fetchPrices: async () => {
          throw new NotFoundError("yfinance", "no chart result");
        },
      }),
    );
    await expect(source.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "not_found",
      source: "yfinance",
    });
  });
});

describe("assertReady", () => {
  it("throws a typed not_configured error with the adapter's reason", () => {
    const source = stubSource({ readiness: () => "FINNHUB_API_KEY not set" });
    expect(() => assertReady(source)).toThrowError(NotConfiguredError);
    try {
      assertReady(source);
    } catch (err) {
      expect(err).toBeInstanceOf(DataSourceError);
      expect((err as DataSourceError).kind).toBe("not_configured");
      expect((err as DataSourceError).message).toContain("FINNHUB_API_KEY not set");
    }
  });

  it("passes silently when the source is ready", () => {
    expect(() => assertReady(stubSource({}))).not.toThrow();
  });
});
