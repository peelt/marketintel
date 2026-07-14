import { createServiceClient } from "@/lib/supabase/service";
import { resolveSecurityId } from "./resolve-security";
import { dedupeBy } from "./dedupe";
import type { RawPriceSnapshot } from "@/lib/data-sources/types";

/**
 * Ingest a batch of price snapshots. PK is (security_id, snapshot_date) so
 * re-running this for the same dates is idempotent — last source wins for a
 * given day.
 */
export async function ingestPriceSnapshots(
  snapshots: RawPriceSnapshot[],
): Promise<{ inserted: number; skipped: number }> {
  if (snapshots.length === 0) return { inserted: 0, skipped: 0 };
  const supabase = createServiceClient();

  // Group by security to resolve UUIDs once per ticker.
  const byTicker = new Map<string, RawPriceSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.ticker}::${s.exchange}`;
    const arr = byTicker.get(key);
    if (arr) arr.push(s);
    else byTicker.set(key, [s]);
  }

  let inserted = 0;
  let skipped = 0;

  for (const [key, batch] of byTicker.entries()) {
    const [ticker, exchange] = key.split("::");
    const securityId = await resolveSecurityId(ticker, exchange);
    if (!securityId) {
      skipped += batch.length;
      continue;
    }

    const rows = dedupeBy(batch, (s) => s.snapshotDate).map((s) => ({
      security_id: securityId,
      snapshot_date: s.snapshotDate,
      open: s.open,
      high: s.high,
      low: s.low,
      close: s.close,
      adjusted_close: s.adjustedClose,
      volume: s.volume,
      currency: s.currency,
      source: s.source,
    }));

    const { error } = await supabase
      .from("price_snapshots")
      .upsert(rows, { onConflict: "security_id,snapshot_date" });
    if (error) throw error;
    inserted += rows.length;
  }

  return { inserted, skipped };
}
