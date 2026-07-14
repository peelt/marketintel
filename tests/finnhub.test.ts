import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfileCache, finnhubPriceSource } from "@/lib/data-sources/finnhub";

/**
 * Finnhub adapter contract tests, fully offline. `fetch` is stubbed with a
 * URL router so each test controls exactly what the provider "returns" —
 * the point is the taxonomy: valid payloads map to normalised rows, drifted
 * payloads throw SchemaChanged, HTTP statuses map to typed errors.
 */

type Route = (url: string) => Response | null;

function stubFetch(route: Route): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const res = route(url);
      if (!res) throw new Error(`unrouted fetch in test: ${url}`);
      return res;
    }),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PROFILE_HSBA = { currency: "GBP", name: "HSBC Holdings", shareOutstanding: 17000 };
const CANDLE_OK = {
  s: "ok",
  t: [1750723200, 1750809600],
  o: [700, 702],
  h: [710, 705],
  l: [698, 699],
  c: [705, 701],
  v: [1000, 1200],
};

const QUERY = { ticker: "HSBA", exchange: "LSE", from: "2026-06-01", to: "2026-06-30" };

beforeEach(() => {
  process.env.FINNHUB_API_KEY = "test-key";
  clearProfileCache();
});

afterEach(() => {
  delete process.env.FINNHUB_API_KEY;
  vi.unstubAllGlobals();
});

describe("finnhub fetchPrices", () => {
  it("maps candles to snapshots with the profile currency and LSE symbol", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      if (url.includes("/stock/candle")) return json(CANDLE_OK);
      if (url.includes("/stock/profile2")) return json(PROFILE_HSBA);
      return null;
    });

    const rows = await finnhubPriceSource.fetchPrices(QUERY);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ticker: "HSBA",
      exchange: "LSE",
      close: 705,
      currency: "GBP",
      source: "finnhub",
    });
    expect(rows[0].snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // LSE symbol convention: HSBA.L
    expect(urls.find((u) => u.includes("/stock/candle"))).toContain(
      encodeURIComponent("HSBA.L"),
    );
  });

  it("throws NotFound when no_data comes back for a symbol the provider doesn't know", async () => {
    stubFetch((url) => {
      if (url.includes("/stock/candle")) return json({ s: "no_data" });
      if (url.includes("/stock/profile2")) return json({}); // empty = unknown symbol
      return null;
    });

    await expect(finnhubPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "not_found",
      source: "finnhub",
    });
  });

  it("returns [] when no_data comes back for a known symbol (empty range, not delisting)", async () => {
    stubFetch((url) => {
      if (url.includes("/stock/candle")) return json({ s: "no_data" });
      if (url.includes("/stock/profile2")) return json(PROFILE_HSBA);
      return null;
    });

    await expect(finnhubPriceSource.fetchPrices(QUERY)).resolves.toEqual([]);
  });

  it("throws SchemaChanged when the response no longer matches the schema", async () => {
    stubFetch((url) => {
      if (url.includes("/stock/candle")) {
        // c became an array of strings — the exact drift the taxonomy exists for
        return json({ ...CANDLE_OK, c: ["705", "701"] });
      }
      return null;
    });

    await expect(finnhubPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "schema_changed",
      source: "finnhub",
    });
  });

  it("maps a 403 (paywalled endpoint) to Blocked so the fallback wrapper can take over", async () => {
    stubFetch((url) => {
      if (url.includes("/stock/candle")) return json({ error: "premium" }, 403);
      return null;
    });

    await expect(finnhubPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "blocked",
      source: "finnhub",
    });
  });

  it("throws not_configured without an API key instead of guessing", async () => {
    delete process.env.FINNHUB_API_KEY;
    stubFetch(() => null); // must never be reached
    await expect(finnhubPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "not_configured",
    });
    expect(finnhubPriceSource.readiness()).toContain("FINNHUB_API_KEY");
  });
});

describe("finnhub fetchDividends", () => {
  it("maps dividend rows, falling back to the profile currency when absent", async () => {
    stubFetch((url) => {
      if (url.includes("/stock/dividend")) {
        return json([
          { date: "2026-05-10", amount: 0.31, payDate: "2026-06-26", recordDate: "2026-05-11" },
        ]);
      }
      if (url.includes("/stock/profile2")) return json(PROFILE_HSBA);
      return null;
    });

    const rows = await finnhubPriceSource.fetchDividends(QUERY);
    expect(rows).toEqual([
      {
        ticker: "HSBA",
        exchange: "LSE",
        exDate: "2026-05-10",
        recordDate: "2026-05-11",
        payDate: "2026-06-26",
        amount: 0.31,
        currency: "GBP",
        source: "finnhub",
      },
    ]);
  });
});

describe("finnhub fetchFundamentals", () => {
  it("maps known metric keys, scales millions, and keeps the full payload in raw", async () => {
    stubFetch((url) => {
      if (url.includes("/stock/metric")) {
        return json({
          metric: {
            marketCapitalization: 160_000, // millions
            epsTTM: 1.12,
            payoutRatioTTM: 0.55,
          },
        });
      }
      if (url.includes("/stock/profile2")) return json(PROFILE_HSBA);
      return null;
    });

    const snap = await finnhubPriceSource.fetchFundamentals({
      ticker: "HSBA",
      exchange: "LSE",
    });
    expect(snap).not.toBeNull();
    expect(snap!.marketCap).toBe(160_000 * 1e6);
    expect(snap!.epsDiluted).toBe(1.12);
    expect(snap!.sharesOutstanding).toBe(17000 * 1e6);
    expect(snap!.periodType).toBe("ttm");
    // ratios agents need later ride along in raw
    expect((snap!.raw as { metric: Record<string, unknown> }).metric.payoutRatioTTM).toBe(0.55);
  });
});
