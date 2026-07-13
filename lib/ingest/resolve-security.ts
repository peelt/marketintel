import { createServiceClient } from "@/lib/supabase/service";

/**
 * Resolve security UUID by (ticker, exchange). Caches in-memory per process.
 * Background jobs and ingest functions call this constantly — keep it cheap.
 */

const cache = new Map<string, string>();

export async function resolveSecurityId(
  ticker: string,
  exchange: string,
): Promise<string | null> {
  const key = `${ticker}::${exchange}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("securities")
    .select("id")
    .eq("ticker", ticker)
    .eq("exchange", exchange)
    .maybeSingle();

  if (error || !data) return null;
  cache.set(key, data.id);
  return data.id;
}

export function clearSecurityCache() {
  cache.clear();
}
