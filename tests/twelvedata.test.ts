import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tdSymbol, twelvedataPriceSource } from "@/lib/data-sources/twelvedata";

/**
 * Twelve Data adapter contract tests, fully offline. `fetch` is stubbed with a
 * URL router so each test controls exactly what the provider "returns". The
 * point is the taxonomy: valid payloads normalise, drift throws SchemaChanged,
 * and Twelve Data's own error envelope (which arrives with a 200) maps onto our
 * error kinds so the fallback wrapper can take over.
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

const TIME_SERIES_HSBA = {
  meta: { symbol: "HSBA", currency: "GBp", exchange: "LSE" },
  values: [
    { datetime: "2026-06-01", open: "700", high: "710", low: "698", close: "705", volume: "1000" },
    { datetime: "2026-06-02", open: "702", high: "706", low: "699", close: "701", volume: "1200" },
  ],
  status: "ok",
};

const QUERY = { ticker: "HSBA", exchange: "LSE", from: "2026-06-01", to: "2026-06-30" };

beforeEach(() => {
  process.env.TWELVEDATA_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.TWELVEDATA_API_KEY;
  vi.unstubAllGlobals();
});

describe("tdSymbol", () => {
  it("passes US tickers bare with no exchange", () => {
    expect(tdSymbol("AAPL", "NASDAQ")).toEqual({ symbol: "AAPL" });
  });
  it("routes LSE names by (symbol, exchange) and strips the trailing-dot quirk", () => {
    expect(tdSymbol("HSBA", "LSE")).toEqual({ symbol: "HSBA", exchange: "LSE" });
    expect(tdSymbol("AV.", "LSE")).toEqual({ symbol: "AV", exchange: "LSE" });
  });
});

describe("twelvedata fetchPrices", () => {
  it("maps time_series values to snapshots, keeping the provider currency", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      if (url.includes("/time_series")) return json(TIME_SERIES_HSBA);
      return null;
    });

    const rows = await twelvedataPriceSource.fetchPrices(QUERY);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ticker: "HSBA",
      exchange: "LSE",
      snapshotDate: "2026-06-01",
      open: 700,
      close: 705,
      volume: 1000,
      currency: "GBp",
      source: "twelvedata",
    });
    // Numeric strings are coerced, not left as strings.
    expect(typeof rows[0].close).toBe("number");
    // LSE is addressed by exchange param, not a suffix.
    const priceUrl = urls.find((u) => u.includes("/time_series"))!;
    expect(priceUrl).toContain("exchange=LSE");
    expect(priceUrl).toContain("symbol=HSBA");
    // The API key must never appear in a value we could log.
    expect(priceUrl).toContain("apikey=test-key");
  });

  it("maps the error envelope (200 body) onto Blocked for a paywalled/unauthorised call", async () => {
    stubFetch((url) => {
      if (url.includes("/time_series")) {
        return json({ status: "error", code: 401, message: "bad key" });
      }
      return null;
    });

    await expect(twelvedataPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "blocked",
      source: "twelvedata",
    });
  });

  it("maps a 429 error envelope onto RateLimited, not missing data", async () => {
    stubFetch((url) => {
      if (url.includes("/time_series")) {
        return json({ status: "error", code: 429, message: "run out of credits" });
      }
      return null;
    });

    await expect(twelvedataPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "rate_limited",
      source: "twelvedata",
    });
  });

  it("maps a bad symbol (code 400/404) onto NotFound so a fallback can try", async () => {
    stubFetch((url) => {
      if (url.includes("/time_series")) {
        return json({ status: "error", code: 400, message: "symbol not found" });
      }
      return null;
    });

    await expect(twelvedataPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "not_found",
      source: "twelvedata",
    });
  });

  it("throws SchemaChanged when a success body no longer matches the schema", async () => {
    stubFetch((url) => {
      // values became an object instead of an array — real drift.
      if (url.includes("/time_series")) {
        return json({ meta: { currency: "USD" }, values: { nope: true } });
      }
      return null;
    });

    await expect(twelvedataPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "schema_changed",
      source: "twelvedata",
    });
  });

  it("throws not_configured without an API key instead of guessing", async () => {
    delete process.env.TWELVEDATA_API_KEY;
    stubFetch(() => null); // must never be reached
    await expect(twelvedataPriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "not_configured",
    });
    expect(twelvedataPriceSource.readiness()).toContain("TWELVEDATA_API_KEY");
  });
});

describe("twelvedata fetchDividends", () => {
  it("maps dividend rows with the meta currency", async () => {
    stubFetch((url) => {
      if (url.includes("/dividends")) {
        return json({
          meta: { currency: "GBp" },
          dividends: [{ ex_date: "2026-05-10", amount: 0.31 }],
        });
      }
      return null;
    });

    const rows = await twelvedataPriceSource.fetchDividends(QUERY);
    expect(rows).toEqual([
      {
        ticker: "HSBA",
        exchange: "LSE",
        exDate: "2026-05-10",
        amount: 0.31,
        currency: "GBp",
        source: "twelvedata",
      },
    ]);
  });
});

describe("twelvedata fetchFundamentals", () => {
  it("defers (throws) so the fallback provider serves fundamentals", async () => {
    stubFetch(() => null); // no request should be made
    await expect(
      twelvedataPriceSource.fetchFundamentals({ ticker: "HSBA", exchange: "LSE" }),
    ).rejects.toMatchObject({ kind: "not_found", source: "twelvedata" });
  });
});
