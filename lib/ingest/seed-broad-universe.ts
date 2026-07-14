import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { chunk } from "@/lib/concurrency";
import {
  fetchBroadMarketConstituents,
  type IndexConstituent,
} from "@/lib/data-sources/index-constituents";
import { getErrorMessage } from "@/lib/errors";

/**
 * Seed/refresh the broad-market screening universe (S&P 500 + FTSE 350) for
 * the Reaction Analyser. Idempotent; tags rows with 'broad_market' plus the
 * index name.
 *
 * Exchange reconciliation: the S&P source doesn't say NYSE vs NASDAQ, so new
 * US rows land with exchange "US" — but a ticker that ALREADY exists on a US
 * exchange (from the curated universes) is treated as the same security and
 * tagged, not duplicated. Same-ticker/different-country collisions (RIO on
 * LSE vs NYSE) stay distinct.
 */

const US_EXCHANGES = new Set(["US", "NYSE", "NASDAQ", "AMEX"]);
const LSE_EXCHANGES = new Set(["LSE", "LON"]);

function sameExchangeClass(a: string, b: string): boolean {
  const upperA = a.toUpperCase();
  const upperB = b.toUpperCase();
  if (US_EXCHANGES.has(upperA) && US_EXCHANGES.has(upperB)) return true;
  if (LSE_EXCHANGES.has(upperA) && LSE_EXCHANGES.has(upperB)) return true;
  return upperA === upperB;
}

export async function seedBroadUniverse(): Promise<{
  fetched: number;
  inserted: number;
  tagged: number;
  errors: { ticker: string; message: string }[];
}> {
  const constituents = await fetchBroadMarketConstituents();
  const supabase = createServiceClient();
  const errors: { ticker: string; message: string }[] = [];

  const existing = await fetchAllRows<{
    id: string;
    ticker: string;
    exchange: string;
    tags: string[];
  }>(
    (from, to) =>
      supabase
        .from("securities")
        .select("id, ticker, exchange, tags")
        .order("id", { ascending: true })
        .range(from, to),
    "broad-universe existing securities",
  );

  const byTicker = new Map<string, typeof existing>();
  for (const row of existing) {
    const arr = byTicker.get(row.ticker) ?? [];
    arr.push(row);
    byTicker.set(row.ticker, arr);
  }

  let inserted = 0;
  let tagged = 0;
  const toInsert: IndexConstituent[] = [];

  for (const c of constituents) {
    const match = (byTicker.get(c.ticker) ?? []).find((row) =>
      sameExchangeClass(row.exchange, c.exchange),
    );
    if (match) {
      const tags = new Set(match.tags ?? []);
      const before = tags.size;
      tags.add("broad_market");
      tags.add(c.index);
      if (tags.size !== before) {
        const { error } = await supabase
          .from("securities")
          .update({ tags: [...tags] })
          .eq("id", match.id);
        if (error) {
          errors.push({ ticker: c.ticker, message: getErrorMessage(error) });
          continue;
        }
      }
      tagged++;
    } else {
      toInsert.push(c);
    }
  }

  for (const batch of chunk(toInsert, 200)) {
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
  }

  return { fetched: constituents.length, inserted, tagged, errors };
}
