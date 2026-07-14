import * as secEdgar from "./sec-edgar";
import * as fred from "./fred";
import * as yfinance from "./yfinance";
import * as finnhub from "./finnhub";
import * as twelvedata from "./twelvedata";
import * as lseRns from "./lse-rns";
import * as companiesHouse from "./companies-house";
import * as newsRss from "./news-rss";
import * as fmp from "./fmp";
import * as polygon from "./polygon";
import * as marketaux from "./marketaux";
import type { AdapterCapabilities, DataSourceName } from "./types";

/**
 * Data source registry. Centralises capability metadata so the orchestrator
 * (PR 3) and the diagnostic UI can answer "which sources are configured?",
 * "what does each provide?", and "which paid sources are stubbed but ready
 * to wire?" without importing every adapter manually.
 */
export const dataSources: Record<DataSourceName, AdapterCapabilities> = {
  sec_edgar: secEdgar.capabilities,
  fred: fred.capabilities,
  yfinance: yfinance.capabilities,
  finnhub: finnhub.capabilities,
  twelvedata: twelvedata.capabilities,
  lse_rns: lseRns.capabilities,
  companies_house: companiesHouse.capabilities,
  news_rss: newsRss.capabilities,
  fmp: fmp.capabilities,
  polygon: polygon.capabilities,
  marketaux: marketaux.capabilities,
};

export function listReadyAdapters(): AdapterCapabilities[] {
  return Object.values(dataSources).filter((c) => c.readinessCheck() === null);
}

export function listStubbedAdapters(): { adapter: AdapterCapabilities; reason: string }[] {
  return Object.values(dataSources)
    .map((c) => ({ adapter: c, reason: c.readinessCheck() }))
    .filter((x): x is { adapter: AdapterCapabilities; reason: string } =>
      x.reason !== null,
    );
}

export { secEdgar, fred, yfinance, finnhub, twelvedata, lseRns, companiesHouse, newsRss, fmp, polygon, marketaux };
export type * from "./types";
export * from "./errors";
export { getPriceSource, withFallback } from "./price-source";
export type { PriceSource, PriceRangeQuery, SymbolQuery, FallbackEvent } from "./price-source";
