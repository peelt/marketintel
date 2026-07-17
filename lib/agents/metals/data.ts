import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { fetchRates } from "@/lib/holdings/fx";
import { rateKey } from "@/lib/holdings/valuation";
import { getErrorMessage } from "@/lib/errors";

/**
 * Data access for the Metals desk. The scored universe is the
 * `metals_buyhold_avoid` tag — gold/silver producers and royalty/streaming
 * companies. ETFs are deliberately NOT scored (they track the metal; scoring
 * them against a producer framework is nonsense) and diversified miners carry
 * their own tags outside this desk's scope.
 */

export interface MetalsSecurity {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  asset_class: string;
  sub_sector: string | null;
}

export interface DividendRow {
  security_id: string;
  ex_date: string;
  amount: number;
}

export async function loadMetalsUniverse(): Promise<MetalsSecurity[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("securities")
    .select("id, ticker, exchange, name, asset_class, sub_sector")
    .contains("tags", ["metals_buyhold_avoid"])
    .is("delisted_at", null)
    .returns<MetalsSecurity[]>();
  if (error) throw new Error(`metals universe: ${getErrorMessage(error)}`);
  return data ?? [];
}

/** Trailing ~400 days of dividends for the given names (TTM yield input). */
export async function loadDividends(
  securityIds: string[],
): Promise<Map<string, DividendRow[]>> {
  const supabase = createServiceClient();
  const sinceIso = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const rows = await fetchAllRows<DividendRow>(
    (from, to) =>
      supabase
        .from("dividends")
        .select("security_id, ex_date, amount")
        .in("security_id", securityIds)
        .gte("ex_date", sinceIso)
        .order("security_id", { ascending: true })
        .order("ex_date", { ascending: true })
        .range(from, to),
    "metals dividends",
  );
  const out = new Map<string, DividendRow[]>();
  for (const r of rows) {
    const arr = out.get(r.security_id) ?? [];
    arr.push(r);
    out.set(r.security_id, arr);
  }
  return out;
}

/**
 * The GLD ETF's security id — its price series (already refreshed daily) is
 * the desk's gold benchmark for relative strength, so no extra API history
 * call is needed. Null when GLD isn't seeded.
 */
export async function goldBenchmarkId(): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("securities")
    .select("id")
    .eq("ticker", "GLD")
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/**
 * Spot-price context line for the research prompt ("gold ~$2,610/oz ·
 * silver ~$31/oz"). Best-effort via Twelve Data forex (XAU/XAG are on the
 * same key as prices); null when unavailable — the research prompt simply
 * omits the context rather than guessing.
 */
export async function metalSpotContext(): Promise<string | null> {
  try {
    const rates = await fetchRates([
      { from: "XAU", to: "USD" },
      { from: "XAG", to: "USD" },
    ]);
    const gold = rates.get(rateKey("XAU", "USD"));
    const silver = rates.get(rateKey("XAG", "USD"));
    const parts: string[] = [];
    if (gold != null) parts.push(`gold ~$${Math.round(gold).toLocaleString("en-US")}/oz`);
    if (silver != null) parts.push(`silver ~$${silver.toFixed(2)}/oz`);
    return parts.length > 0 ? parts.join(" · ") : null;
  } catch (err) {
    console.warn(`metalSpotContext unavailable: ${getErrorMessage(err)}`);
    return null;
  }
}
