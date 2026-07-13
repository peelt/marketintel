import type {
  AdapterCapabilities,
  RawDividend,
  RawFinancialsSnapshot,
  RawSecurity,
} from "./types";

/**
 * Financial Modeling Prep (paid). NOT ACTIVE IN V1.
 *
 * Scaffolded behind the same interface so the swap from yfinance/SEC EDGAR
 * is a config-flag change, not a refactor. Adds coverage for:
 *   - Clean quarterly financial statements going back years
 *   - IPO calendar with date, price range, exchange
 *   - Dividend history with declared, ex, record, pay dates
 *   - Insider trading
 *
 * Reference: https://site.financialmodelingprep.com/developer/docs
 *
 * To activate later: set FMP_API_KEY in env, swap the consumer agents to call
 * these functions instead of the free equivalents.
 */

function notActive(): never {
  throw new Error(
    "FMP adapter is not active in v1. Set FMP_API_KEY and implement these methods when promoting to paid tier.",
  );
}

export async function fetchIpoCalendar(_params: {
  from: string;
  to: string;
}): Promise<RawSecurity[]> {
  notActive();
}

export async function fetchQuarterlyFinancials(_params: {
  ticker: string;
  exchange: string;
  limit?: number;
}): Promise<RawFinancialsSnapshot[]> {
  notActive();
}

export async function fetchDividendHistory(_params: {
  ticker: string;
  exchange: string;
}): Promise<RawDividend[]> {
  notActive();
}

export const capabilities: AdapterCapabilities = {
  name: "fmp",
  paid: true,
  readinessCheck: () =>
    process.env.FMP_API_KEY ? null : "FMP adapter stubbed; set FMP_API_KEY to activate",
  provides: ["securities", "financials", "dividends"],
};
