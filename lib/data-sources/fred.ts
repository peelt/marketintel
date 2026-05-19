import { httpJson } from "./http";
import type { AdapterCapabilities, RawMacroObservation } from "./types";

/**
 * FRED (Federal Reserve Economic Data) adapter.
 *
 * Free with a registration key. https://fred.stlouisfed.org/docs/api/api_key.html
 * Rate limit: 120 req/min — generous, we throttle modestly.
 *
 * Used by:
 *   - Geopolitical scanner (PR 7) — DXY, 10Y, 2Y, oil, gold, copper, VIX
 *   - Energy beneficiary screener (PR 6) — WTI, Brent, Henry Hub, NG futures
 *   - Metals navigator (PR 6) — gold, silver, copper LBMA fixes
 */

const BASE = "https://api.stlouisfed.org/fred";
const HOST_THROTTLE_MS = 100;

function apiKey(): string {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY is not set");
  return key;
}

interface FredObservationsResponse {
  observations: { date: string; value: string }[];
  units: string;
}

interface FredSeriesResponse {
  seriess: { id: string; title: string; units: string; frequency: string }[];
}

export async function fetchSeries(params: {
  seriesId: string;
  observationStart?: string; // YYYY-MM-DD
  observationEnd?: string;
  limit?: number;
}): Promise<RawMacroObservation[]> {
  const qs = new URLSearchParams({
    series_id: params.seriesId,
    api_key: apiKey(),
    file_type: "json",
  });
  if (params.observationStart) qs.set("observation_start", params.observationStart);
  if (params.observationEnd) qs.set("observation_end", params.observationEnd);
  if (params.limit) qs.set("limit", String(params.limit));

  const data = await httpJson<FredObservationsResponse>(
    `${BASE}/series/observations?${qs.toString()}`,
    { hostThrottleMs: HOST_THROTTLE_MS },
  );

  return data.observations
    .filter((o) => o.value !== "." && o.value !== "")
    .map((o) => ({
      seriesId: params.seriesId,
      source: "fred",
      observedAt: o.date,
      value: Number(o.value),
      units: data.units,
    }));
}

export async function fetchSeriesMetadata(seriesId: string) {
  const qs = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey(),
    file_type: "json",
  });
  const data = await httpJson<FredSeriesResponse>(
    `${BASE}/series?${qs.toString()}`,
    { hostThrottleMs: HOST_THROTTLE_MS },
  );
  return data.seriess[0];
}

/**
 * Curated FRED series used across the agents. Centralised so we can audit
 * what we're tracking and add new ones without hunting through agent code.
 */
export const SERIES = {
  // FX
  dxy: "DTWEXBGS", // Trade-weighted broad US dollar
  // Rates
  ust10y: "DGS10",
  ust2y: "DGS2",
  // Commodities
  oilWti: "DCOILWTICO",
  oilBrent: "DCOILBRENTEU",
  natgasHenryHub: "DHHNGSP",
  goldFix: "GOLDPMGBD228NLBM",
  silverFix: "SLVPRUSD",
  copper: "PCOPPUSDM",
  // Risk
  vix: "VIXCLS",
  highYieldSpread: "BAMLH0A0HYM2",
  // Macro
  cpi: "CPIAUCSL",
  unemploymentUs: "UNRATE",
} as const;

export const capabilities: AdapterCapabilities = {
  name: "fred",
  paid: false,
  readinessCheck: () => (process.env.FRED_API_KEY ? null : "FRED_API_KEY not set"),
  provides: ["macro"],
};
