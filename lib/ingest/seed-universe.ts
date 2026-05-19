import { createServiceClient } from "@/lib/supabase/service";
import { allSeedSecurities } from "@/lib/data-sources/universes";
import { getErrorMessage } from "@/lib/errors";

/**
 * Seeds the `securities` table from the curated JSON universes.
 *
 * Idempotent — uses (ticker, exchange) as the conflict target and merges tag
 * arrays additively rather than overwriting. Safe to run repeatedly.
 *
 * Service-role client; only callable from server contexts.
 */
export async function seedUniverse(): Promise<{
  inserted: number;
  updated: number;
  errors: { ticker: string; exchange: string; message: string }[];
}> {
  const supabase = createServiceClient();
  const seeds = allSeedSecurities();
  const errors: { ticker: string; exchange: string; message: string }[] = [];
  let inserted = 0;
  let updated = 0;

  for (const seed of seeds) {
    try {
      const { data: existing, error: selErr } = await supabase
        .from("securities")
        .select("id, tags")
        .eq("ticker", seed.ticker)
        .eq("exchange", seed.exchange)
        .maybeSingle();
      if (selErr) throw selErr;

      const payload = {
        ticker: seed.ticker,
        exchange: seed.exchange,
        name: seed.name,
        country: seed.country,
        asset_class: seed.asset_class,
        sector: seed.sector,
        sub_sector: seed.sub_sector,
        currency: seed.currency,
      };

      if (!existing) {
        const { error } = await supabase
          .from("securities")
          .insert({ ...payload, tags: seed.tags ?? [] });
        if (error) throw error;
        inserted++;
      } else {
        const mergedTags = Array.from(
          new Set([...(existing.tags ?? []), ...(seed.tags ?? [])]),
        );
        const { error } = await supabase
          .from("securities")
          .update({ ...payload, tags: mergedTags })
          .eq("id", existing.id);
        if (error) throw error;
        updated++;
      }
    } catch (err) {
      errors.push({
        ticker: seed.ticker,
        exchange: seed.exchange,
        message: getErrorMessage(err),
      });
    }
  }

  return { inserted, updated, errors };
}
