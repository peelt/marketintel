import { describe, expect, it } from "vitest";
import type { IndexConstituent } from "@/lib/data-sources/index-constituents";
import {
  exchangeClass,
  MAX_PRUNE_SHARE,
  planUniverseRefresh,
  type ExistingSecurity,
} from "@/lib/ingest/universe-plan";

const c = (ticker: string, exchange: string, index: IndexConstituent["index"]): IndexConstituent => ({
  ticker, exchange, name: ticker, index,
});
const row = (id: string, ticker: string, exchange: string, tags: string[]): ExistingSecurity => ({
  id, ticker, exchange, tags,
});

describe("planUniverseRefresh", () => {
  // A universe of ten, so one leaver (10%) sits exactly at the safety cap.
  const base = Array.from({ length: 10 }, (_, i) =>
    row(`id${i}`, `T${i}`, "US", ["broad_market", "sp500"]),
  );
  const baseLive = base.map((r) => c(r.ticker, "US", "sp500"));

  it("adds a newly promoted name — the drift that hid Volex and Reddit", () => {
    const plan = planUniverseRefresh(base, [...baseLive, c("VLX", "LSE", "ftse250")]);
    expect(plan.inserts.map((i) => i.ticker)).toEqual(["VLX"]);
    expect(plan.pruned).toEqual([]);
  });

  it("prunes a relegated name but keeps its row and its non-index tags", () => {
    const existing = [...base, row("gbg", "GBG", "LSE", ["broad_market", "ftse250", "high_yield_watchlist"])];
    const plan = planUniverseRefresh(existing, baseLive);
    expect(plan.pruned).toEqual(["GBG"]);
    const u = plan.updates.find((x) => x.id === "gbg")!;
    // The row is retagged, not deleted: report history and holdings point at it.
    expect(u.tags).toEqual(["high_yield_watchlist"]);
  });

  it("retags a name that moves between indices", () => {
    // Entain/Persimmon: FTSE 100 → FTSE 250 in the September 2026 review.
    const existing = [...base, row("ent", "ENT", "LSE", ["broad_market", "ftse100"])];
    const plan = planUniverseRefresh(existing, [...baseLive, c("ENT", "LSE", "ftse250")]);
    expect(plan.updates.find((x) => x.id === "ent")!.tags).toEqual(["broad_market", "ftse250"]);
    expect(plan.pruned).toEqual([]);
  });

  it("leaves an unchanged member alone", () => {
    const plan = planUniverseRefresh(base, baseLive);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it("matches NYSE/NASDAQ rows against the S&P's undifferentiated 'US'", () => {
    const existing = [...base, row("nv", "NVDA", "NASDAQ", ["broad_market", "sp500"])];
    const plan = planUniverseRefresh(existing, [...baseLive, c("NVDA", "US", "sp500")]);
    expect(plan.inserts).toEqual([]);
    expect(plan.pruned).toEqual([]);
  });

  it("keeps same-ticker different-market names distinct", () => {
    // RIO on LSE and NYSE are different securities.
    const existing = [...base, row("rio-us", "RIO", "NYSE", ["curated"])];
    const plan = planUniverseRefresh(existing, [...baseLive, c("RIO", "LSE", "ftse100")]);
    expect(plan.inserts.map((i) => `${i.ticker}/${i.exchange}`)).toEqual(["RIO/LSE"]);
  });

  it("refuses to prune when a partial source would gut the universe", () => {
    // Live list lost two of ten names — 20%, above the cap. A real review
    // moves a few percent; this is a broken or truncated source.
    const plan = planUniverseRefresh(base, baseLive.slice(2));
    expect(plan.pruneRefused).toBe(true);
    expect(plan.pruned).toEqual([]);
    expect(plan.updates.filter((u) => !u.tags.includes("broad_market"))).toEqual([]);
  });

  it("still prunes at exactly the cap", () => {
    const plan = planUniverseRefresh(base, baseLive.slice(1));
    expect(1 / base.length).toBeLessThanOrEqual(MAX_PRUNE_SHARE);
    expect(plan.pruneRefused).toBe(false);
    expect(plan.pruned).toEqual(["T0"]);
  });

  it("never screens a company twice when it has duplicate rows", () => {
    // Live shape: the retired geopolitical desk's NASDAQ row for NVDA was
    // created after the S&P seed's "US" row. The incumbent keeps membership;
    // the duplicate is left exactly as it is.
    const existing = [
      ...base,
      row("aaa-geo", "NVDA", "NASDAQ", ["geopolitical_exposed"]), // sorts first
      row("zzz-sp", "NVDA", "US", ["broad_market", "sp500"]),
    ];
    const plan = planUniverseRefresh(existing, [...baseLive, c("NVDA", "US", "sp500")]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it("strips a second member row so the company is screened once", () => {
    const existing = [
      ...base,
      row("a", "NVDA", "US", ["broad_market", "sp500"]),
      row("b", "NVDA", "NASDAQ", ["broad_market", "sp500", "curated"]),
    ];
    const plan = planUniverseRefresh(existing, [...baseLive, c("NVDA", "US", "sp500")]);
    expect(plan.updates).toEqual([{ id: "b", ticker: "NVDA", tags: ["curated"] }]);
    // Still in the index, so it isn't a leaver.
    expect(plan.pruned).toEqual([]);
  });

  it("collects every index a name belongs to", () => {
    const plan = planUniverseRefresh(base, [...baseLive, c("X", "LSE", "ftse100"), c("X", "LSE", "ftse250")]);
    expect(plan.inserts.map((i) => i.ticker)).toEqual(["X"]);
  });
});

describe("exchangeClass", () => {
  it("folds US venues together and LSE aliases together", () => {
    expect(["US", "NYSE", "nasdaq", "AMEX"].map(exchangeClass)).toEqual(["US", "US", "US", "US"]);
    expect(["LSE", "LON"].map(exchangeClass)).toEqual(["LSE", "LSE"]);
  });
});
