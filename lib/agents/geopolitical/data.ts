import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";

/**
 * Data access for the Geopolitical desk. The scored universe is the
 * `geopolitical_exposed` tag — a curated cross-sector set (defense, semis,
 * energy, critical minerals, agriculture, shipping, China-exposed tech) that
 * geopolitics actually moves. The desk grades how each name is POSITIONED for
 * the current backdrop; it never bets on an outcome (I2).
 */

export interface GeopoliticalSecurity {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  sub_sector: string | null;
}

export async function loadGeopoliticalUniverse(): Promise<GeopoliticalSecurity[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("securities")
    .select("id, ticker, exchange, name, sector, sub_sector")
    .contains("tags", ["geopolitical_exposed"])
    .is("delisted_at", null)
    .returns<GeopoliticalSecurity[]>();
  if (error) throw new Error(`geopolitical universe: ${getErrorMessage(error)}`);
  return data ?? [];
}
