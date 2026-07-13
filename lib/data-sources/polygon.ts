import type {
  AdapterCapabilities,
  RawPriceSnapshot,
} from "./types";

/**
 * Polygon.io (paid). NOT ACTIVE IN V1.
 *
 * Held back as the upgrade path for yfinance if/when Yahoo's undocumented
 * endpoints start failing in production. $29/mo Starter is enough for our
 * cadence and gives proper SLAs.
 *
 * Reference: https://polygon.io/docs
 */

function notActive(): never {
  throw new Error(
    "Polygon adapter is not active in v1. Set POLYGON_API_KEY and implement these methods when promoting to paid tier.",
  );
}

export async function fetchDailyAggregates(_params: {
  ticker: string;
  from: string;
  to: string;
}): Promise<RawPriceSnapshot[]> {
  notActive();
}

export const capabilities: AdapterCapabilities = {
  name: "polygon",
  paid: true,
  readinessCheck: () =>
    process.env.POLYGON_API_KEY ? null : "Polygon adapter stubbed; set POLYGON_API_KEY to activate",
  provides: ["prices"],
};
