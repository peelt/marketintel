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
  /** Securities stripped of a curated tag they no longer hold in the seeds. */
  untagged: number;
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

  // Reconcile curated tags: tag merging is additive, so a name REMOVED from a
  // curated list would otherwise keep its watchlist tag in the DB forever and
  // keep appearing in reports. For every tag the curated lists use, strip it
  // from securities that no longer carry it in the seeds. Only seed-owned tags
  // are touched — broad-universe tags (sp500/ftse350) are managed elsewhere.
  let untagged = 0;
  const seedTagMap = new Map<string, Set<string>>();
  for (const seed of seeds) {
    for (const tag of seed.tags ?? []) {
      const set = seedTagMap.get(tag) ?? new Set<string>();
      set.add(`${seed.ticker}::${seed.exchange}`);
      seedTagMap.set(tag, set);
    }
  }
  for (const [tag, keep] of seedTagMap) {
    try {
      const { data: tagged, error } = await supabase
        .from("securities")
        .select("id, ticker, exchange, tags")
        .contains("tags", [tag])
        .returns<{ id: string; ticker: string; exchange: string; tags: string[] }[]>();
      if (error) throw error;
      for (const row of tagged ?? []) {
        if (keep.has(`${row.ticker}::${row.exchange}`)) continue;
        const nextTags = (row.tags ?? []).filter((t) => t !== tag);
        const { error: updErr } = await supabase
          .from("securities")
          .update({ tags: nextTags })
          .eq("id", row.id);
        if (updErr) throw updErr;
        untagged++;
      }
    } catch (err) {
      errors.push({ ticker: `tag:${tag}`, exchange: "-", message: getErrorMessage(err) });
    }
  }

  return { inserted, updated, untagged, errors };
}
