import { inngest } from "../client";
import { seedBroadUniverse } from "@/lib/ingest/seed-broad-universe";

/**
 * Keep the screening universe in step with the S&P 500 and FTSE 350.
 *
 * It used to be seeded once (14–15 Jul 2026) and never again, so by October
 * it had drifted by 34 names — promoted companies the desk never screened and
 * relegated ones it still did. FTSE reviews land quarterly and S&P makes ad-hoc
 * changes in between, so this runs weekly: three page fetches and a handful of
 * writes, so the cost is nil and the lag is at most a week.
 *
 * Saturday 06:00 UTC — after the overnight edition, before anything trades.
 * New names get a year of price history straight away (silent, so it never
 * wakes the desk); without it they would have nothing to screen against.
 */
export const universeRefresh = inngest.createFunction(
  { id: "broad-universe-refresh", retries: 1 },
  { cron: "0 6 * * 6" },
  async ({ step }) => {
    const result = await step.run("refresh-universe", () => seedBroadUniverse());
    if (result.added.length > 0) {
      await step.sendEvent("backfill-new-names", {
        name: "ingest/refresh.requested",
        data: {
          feed: "prices",
          lookbackDays: 400,
          tickers: result.added,
          silent: true,
        },
      });
    }
    return {
      fetched: result.fetched,
      added: result.added.map((a) => a.ticker),
      pruned: result.pruned,
      pruneRefused: result.pruneRefused,
      retagged: result.retagged,
      errors: result.errors.length,
    };
  },
);
