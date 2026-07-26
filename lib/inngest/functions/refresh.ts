import { inngest } from "../client";
import { allSeedSecurities } from "@/lib/data-sources/universes";

/**
 * Weekly fundamentals + dividends refresh for the dividend + metals
 * universes.
 *
 * UNREGISTERED since the 2026-07 scope reduction: both desks it fed are
 * retired, and no live desk reads financials_snapshot any more (the Reaction
 * framework dropped its fundamentals signals in migration 0015 — the source
 * never populated the columns they read). The function stays in the tree so
 * a desk revival can re-register it in app/api/inngest/route.ts.
 */

const FUND_DIV_TAGS = ["high_yield_watchlist", "metals_buyhold_avoid"] as const;

/**
 * The names that actually feed fundamentals/dividend signals — the dividend
 * and metals universes, deduped. Pure; exported for tests. Geopolitical/energy
 * names are excluded: geopolitical has no price/fundamentals signals, energy
 * has no live agent, so fetching their fundamentals would be wasted calls.
 */
export function fundamentalsUniverse(): { ticker: string; exchange: string }[] {
  const byKey = new Map<string, { ticker: string; exchange: string }>();
  for (const s of allSeedSecurities()) {
    if ((s.tags ?? []).some((t) => (FUND_DIV_TAGS as readonly string[]).includes(t))) {
      byKey.set(`${s.ticker}::${s.exchange}`, {
        ticker: s.ticker,
        exchange: s.exchange,
      });
    }
  }
  return [...byKey.values()];
}

export const weeklyDataRefresh = inngest.createFunction(
  { id: "weekly-fundamentals-dividends", retries: 1 },
  { cron: "0 15 * * 5" }, // Fri 15:00 UTC — before the Fri 18:00 & Sat 12:00 runs
  async ({ step }) => {
    const tickers = await step.run("load-fund-div-universe", async () =>
      fundamentalsUniverse(),
    );
    if (tickers.length === 0) {
      return { skipped: "no dividend/metals names seeded yet" };
    }
    // Two chunked jobs, same machinery as every other refresh.
    await step.sendEvent("request-fundamentals", {
      name: "ingest/refresh.requested",
      data: { feed: "fundamentals", tickers },
    });
    await step.sendEvent("request-dividends", {
      name: "ingest/refresh.requested",
      data: { feed: "dividends", lookbackDays: 5 * 365, tickers },
    });
    return { requested: tickers.length };
  },
);
