import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { chunk } from "@/lib/concurrency";
import { fetchBroadMarketConstituents } from "@/lib/data-sources/index-constituents";
import {
  MAX_PRUNE_SHARE,
  planUniverseRefresh,
  type ExistingSecurity,
} from "./universe-plan";
import { getErrorMessage } from "@/lib/errors";

/**
 * Refresh the broad-market screening universe (S&P 500 + FTSE 350) so it
 * tracks the live indices in BOTH directions: promoted names are added,
 * relegated names lose their index tags (the row stays — history references
 * it), and names that move between indices are retagged. Idempotent. The
 * decisions are made by the pure planUniverseRefresh (./universe-plan.ts).
 *
 * Exchange reconciliation: the S&P source doesn't say NYSE vs NASDAQ, so new
 * US rows land with exchange "US" — but a ticker that ALREADY exists on a US
 * exchange (from the curated universes) is treated as the same security and
 * tagged, not duplicated. Same-ticker/different-country collisions (RIO on
 * LSE vs NYSE) stay distinct.
 */

export interface UniverseRefreshResult {
  fetched: number;
  inserted: number;
  retagged: number;
  pruned: string[];
  pruneRefused: boolean;
  /** Newly-added names — they have no price history yet. */
  added: { ticker: string; exchange: string }[];
  errors: { ticker: string; message: string }[];
}

export async function seedBroadUniverse(): Promise<UniverseRefreshResult> {
  // Throws (SchemaChangedError) when any list parses to an implausible size,
  // so a broken page can never reach the prune below.
  const constituents = await fetchBroadMarketConstituents();
  const supabase = createServiceClient();
  const errors: { ticker: string; message: string }[] = [];

  const existing = await fetchAllRows<ExistingSecurity>(
    (from, to) =>
      supabase
        .from("securities")
        .select("id, ticker, exchange, tags")
        .is("delisted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    "broad-universe existing securities",
  );

  const plan = planUniverseRefresh(existing, constituents);
  if (plan.pruneRefused) {
    console.error(
      "seedBroadUniverse: prune refused — the live index would remove more than " +
        `${Math.round(MAX_PRUNE_SHARE * 100)}% of the universe; adds and retags still applied`,
    );
  }

  let retagged = 0;
  for (const u of plan.updates) {
    const { error } = await supabase
      .from("securities")
      .update({ tags: u.tags })
      .eq("id", u.id);
    if (error) errors.push({ ticker: u.ticker, message: getErrorMessage(error) });
    else retagged++;
  }

  let inserted = 0;
  const added: { ticker: string; exchange: string }[] = [];
  for (const batch of chunk(plan.inserts, 200)) {
    const { error } = await supabase.from("securities").insert(
      batch.map((c) => ({
        ticker: c.ticker,
        exchange: c.exchange,
        name: c.name,
        country: c.exchange === "LSE" ? "GB" : "US",
        currency: c.exchange === "LSE" ? "GBP" : "USD",
        asset_class: "equity",
        tags: ["broad_market", c.index],
      })),
    );
    if (error) {
      errors.push({
        ticker: batch.map((b) => b.ticker).join(","),
        message: getErrorMessage(error),
      });
      continue;
    }
    inserted += batch.length;
    added.push(...batch.map((c) => ({ ticker: c.ticker, exchange: c.exchange })));
  }

  return {
    fetched: constituents.length,
    inserted,
    retagged,
    pruned: plan.pruned,
    pruneRefused: plan.pruneRefused,
    added,
    errors,
  };
}

/**
 * Request a year of price history for names the refresh just added. Without
 * it a new name has nothing to screen against: the daily passes fetch only a
 * few days, while the drop screen needs a 5-session window and the repricing
 * signal a trailing-year high. Silent, so it never wakes the desk. Fail-soft:
 * the next daily pass still fills recent closes.
 */
export async function requestBackfillForAdded(
  added: { ticker: string; exchange: string }[],
): Promise<boolean> {
  if (added.length === 0) return false;
  try {
    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
      name: "ingest/refresh.requested",
      data: { feed: "prices", lookbackDays: 400, tickers: added, silent: true },
    });
    return true;
  } catch (err) {
    console.error(`requestBackfillForAdded: ${getErrorMessage(err)}`);
    return false;
  }
}
