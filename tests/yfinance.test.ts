import { afterEach, describe, expect, it, vi } from "vitest";
import { yfinancePriceSource } from "@/lib/data-sources/yfinance";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const QUERY = { ticker: "AV.", exchange: "LSE", from: "2026-06-01", to: "2026-06-30" };

function chartBody(overrides?: Record<string, unknown>) {
  return {
    chart: {
      result: [
        {
          meta: { currency: "GBp", symbol: "AV.L", exchangeName: "LSE" },
          timestamp: [1750723200],
          indicators: {
            quote: [{ open: [480], high: [485], low: [478], close: [482], volume: [900] }],
            adjclose: [{ adjclose: [482] }],
          },
          ...overrides,
        },
      ],
      error: null,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("yfinance fetchPrices", () => {
  it("threads the reported currency (GBp — pence) onto every snapshot", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(String(input));
        return json(chartBody());
      }),
    );

    const rows = await yfinancePriceSource.fetchPrices(QUERY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ close: 482, currency: "GBp", source: "yfinance" });
    // trailing-dot ticker maps to the real Yahoo symbol
    expect(urls[0]).toContain(encodeURIComponent("AV.L"));
  });

  it("maps Yahoo's in-body Not Found error to a typed NotFound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          chart: {
            result: null,
            error: { code: "Not Found", description: "No data found, symbol may be delisted" },
          },
        }),
      ),
    );

    await expect(yfinancePriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "not_found",
      source: "yfinance",
    });
  });

  it("throws SchemaChanged when the chart payload drifts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ chart: { results: [] } })), // `result` renamed
    );

    await expect(yfinancePriceSource.fetchPrices(QUERY)).rejects.toMatchObject({
      kind: "schema_changed",
      source: "yfinance",
    });
  });
});
