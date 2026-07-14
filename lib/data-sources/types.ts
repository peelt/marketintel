/**
 * Normalised return shapes for data-source adapters.
 *
 * Every adapter — free or paid — converts its provider-specific response into
 * one of these shapes. The ingest layer (lib/ingest/*) consumes them and
 * writes to Supabase. Keep these stable: adding a paid provider later should
 * mean implementing the same interface, never reshaping consumers.
 */

export type DataSourceName =
  | "sec_edgar"
  | "fred"
  | "yfinance"
  | "finnhub"
  | "twelvedata"
  | "lse_rns"
  | "companies_house"
  | "news_rss"
  | "fmp"
  | "polygon"
  | "marketaux";

export interface RawSecurity {
  ticker: string;
  exchange: string;
  name: string;
  country?: string;
  assetClass: "equity" | "etf" | "royalty" | "adr" | "reit" | "trust";
  sector?: string;
  subSector?: string;
  currency: string;
  classifications?: Record<string, unknown>;
  tags?: string[];
  listedAt?: string; // YYYY-MM-DD
  source: DataSourceName;
  sourceRef?: string; // CIK, ISIN, etc.
}

export interface RawFinancialsSnapshot {
  ticker: string;
  exchange: string;
  periodEnd: string; // YYYY-MM-DD
  periodType: "q" | "y" | "ttm";
  fiscalPeriod?: string;
  revenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  ebitda?: number;
  netIncome?: number;
  epsDiluted?: number;
  totalAssets?: number;
  totalDebt?: number;
  cashAndEquivalents?: number;
  shareholdersEquity?: number;
  operatingCashFlow?: number;
  capex?: number;
  freeCashFlow?: number;
  dividendsPaid?: number;
  marketCap?: number;
  enterpriseValue?: number;
  sharesOutstanding?: number;
  source: DataSourceName;
  sourceUrl?: string;
  raw?: unknown;
}

export interface RawDividend {
  ticker: string;
  exchange: string;
  exDate: string; // YYYY-MM-DD
  recordDate?: string;
  payDate?: string;
  amount: number;
  currency: string;
  frequency?: "annual" | "semi" | "quarterly" | "monthly" | "special";
  source: DataSourceName;
}

export interface RawPriceSnapshot {
  ticker: string;
  exchange: string;
  snapshotDate: string; // YYYY-MM-DD
  open?: number;
  high?: number;
  low?: number;
  close: number;
  adjustedClose?: number;
  volume?: number;
  /**
   * Currency AS REPORTED by the provider — LSE prices arrive in pence
   * ("GBp"), not pounds. Persisted verbatim so consumers can normalise;
   * dropping it is a latent 100× error on UK names.
   */
  currency?: string;
  source: DataSourceName;
}

export interface RawFiling {
  /** May be unknown for fresh S-1s where the issuer isn't yet in the universe. */
  ticker?: string;
  exchange?: string;
  issuerName?: string;
  issuerCik?: string;
  source: "sec_edgar" | "lse_rns" | "companies_house" | "other";
  filingType: string;
  filedAt: string; // ISO
  periodEnd?: string;
  url: string;
  accessionNumber?: string;
  rawText?: string;
}

export interface RawFilingSection {
  accessionNumber: string;
  sectionName: string;
  content: string;
}

export interface RawNewsArticle {
  source: string;
  url: string;
  title: string;
  content?: string;
  summary?: string;
  publishedAt: string; // ISO
  /** Tickers explicitly tagged by the source. Ingest layer resolves to UUIDs. */
  tickers?: string[];
  tags?: Record<string, unknown>;
  sentiment?: number;
}

export interface RawMacroObservation {
  seriesId: string;
  source: DataSourceName;
  observedAt: string; // YYYY-MM-DD
  value: number;
  units?: string;
}

/**
 * Adapter capability descriptor. Each adapter exports a `capabilities` const
 * so the ingest orchestrator (PR 3) can dispatch the right source for the
 * right shape — and so we can fail fast if a paid adapter is selected without
 * its API key in env.
 */
export interface AdapterCapabilities {
  name: DataSourceName;
  paid: boolean;
  /** Returns null if the adapter is configured and ready, or a reason string. */
  readinessCheck: () => string | null;
  provides: Array<
    | "securities"
    | "financials"
    | "dividends"
    | "prices"
    | "filings"
    | "news"
    | "macro"
  >;
}
