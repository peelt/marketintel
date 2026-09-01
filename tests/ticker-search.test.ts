import { describe, expect, it } from "vitest";
import {
  normaliseQuery,
  rankSecurityMatches,
  type SearchableSecurity,
} from "@/lib/reaction/ticker-search";

// A slice of the real Reaction universe — the names behind the live cases
// this ranker was built to fix.
const U: SearchableSecurity[] = [
  { id: "1", ticker: "VOD", exchange: "LSE", name: "Vodafone Group" },
  { id: "2", ticker: "AAPL", exchange: "US", name: "Apple Inc." },
  { id: "3", ticker: "APP", exchange: "US", name: "AppLovin" },
  { id: "4", ticker: "AMAT", exchange: "US", name: "Applied Materials" },
  { id: "5", ticker: "NTAP", exchange: "US", name: "NetApp" },
  { id: "6", ticker: "TSCO", exchange: "LSE", name: "Tesco" },
  { id: "7", ticker: "NVDA", exchange: "US", name: "Nvidia" },
  { id: "8", ticker: "NXT", exchange: "LSE", name: "Next plc" },
  { id: "9", ticker: "ROL", exchange: "US", name: "Rollins, Inc." },
  { id: "10", ticker: "RR", exchange: "LSE", name: "Rolls-Royce Holdings" },
  { id: "11", ticker: "CVX", exchange: "US", name: "Chevron Corporation" },
  { id: "12", ticker: "DVN", exchange: "US", name: "Devon Energy" },
  { id: "13", ticker: "VZ", exchange: "US", name: "Verizon Communications" },
  { id: "14", ticker: "AMD", exchange: "US", name: "Advanced Micro Devices" },
  { id: "15", ticker: "MSFT", exchange: "US", name: "Microsoft" },
  { id: "16", ticker: "MU", exchange: "US", name: "Micron Technology" },
  { id: "17", ticker: "V", exchange: "US", name: "Visa Inc." },
];

const tickers = (q: string, limit?: number) =>
  rankSecurityMatches(q, U, limit).map((s) => s.ticker);

describe("normaliseQuery", () => {
  it("uppercases, trims and strips the London suffix", () => {
    expect(normaliseQuery("  nxt.l ")).toEqual({ term: "NXT", preferLse: true });
    expect(normaliseQuery("voda")).toEqual({ term: "VODA", preferLse: false });
    expect(normaliseQuery("a,b(c)%")).toEqual({ term: "A B C", preferLse: false });
  });
});

describe("rankSecurityMatches", () => {
  it("finds Vodafone from 'voda' — the live failure", () => {
    expect(tickers("voda")).toEqual(["VOD"]);
  });

  it("ranks an exact ticker above prefix and name matches", () => {
    // Today's server query put Apple first; the user who typed APP meant APP.
    expect(tickers("app")).toEqual(["APP", "AAPL", "AMAT", "NTAP"]);
  });

  it("matches company names, not just tickers", () => {
    expect(tickers("tesc")).toEqual(["TSCO"]);
    expect(tickers("nvid")).toEqual(["NVDA"]);
    // Neither is a ticker prefix (the query is longer than ROL), so both are
    // name matches and order by name: Rollins before Rolls-Royce.
    expect(tickers("roll")).toEqual(["ROL", "RR"]);
  });

  it("honours the .L convention and prefers the London line", () => {
    expect(tickers("nxt.l")).toEqual(["NXT"]);
    expect(rankSecurityMatches("nxt.l", U)[0].exchange).toBe("LSE");
  });

  it("does not surface mid-word name hits ahead of ticker matches", () => {
    // 'v' used to return Chevron and Devon (name contains 'v') before Visa.
    const got = tickers("v");
    expect(got[0]).toBe("V");
    expect(got.indexOf("VOD")).toBeLessThan(got.indexOf("CVX"));
    expect(got.indexOf("VZ")).toBeLessThan(got.indexOf("DVN"));
  });

  it("word-boundary name matches outrank mid-word ones", () => {
    const got = tickers("micro");
    // 'Advanced Micro', 'Micron', 'Microsoft' all start a word, so they tie on
    // tier and order by name.
    expect(got).toEqual(["AMD", "MU", "MSFT"]);
  });

  it("respects the limit and returns nothing for an empty query", () => {
    expect(tickers("a", 2)).toHaveLength(2);
    expect(tickers("")).toEqual([]);
    expect(tickers("   ")).toEqual([]);
  });
});
