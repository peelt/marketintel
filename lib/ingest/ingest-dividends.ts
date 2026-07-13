import { createServiceClient } from "@/lib/supabase/service";
import { resolveSecurityId } from "./resolve-security";
import type { RawDividend } from "@/lib/data-sources/types";

export async function ingestDividends(
  dividends: RawDividend[],
): Promise<{ inserted: number; skipped: number }> {
  if (dividends.length === 0) return { inserted: 0, skipped: 0 };
  const supabase = createServiceClient();

  let inserted = 0;
  let skipped = 0;

  const byTicker = new Map<string, RawDividend[]>();
  for (const d of dividends) {
    const key = `${d.ticker}::${d.exchange}`;
    const arr = byTicker.get(key);
    if (arr) arr.push(d);
    else byTicker.set(key, [d]);
  }

  for (const [key, batch] of byTicker.entries()) {
    const [ticker, exchange] = key.split("::");
    const securityId = await resolveSecurityId(ticker, exchange);
    if (!securityId) {
      skipped += batch.length;
      continue;
    }

    const rows = batch.map((d) => ({
      security_id: securityId,
      ex_date: d.exDate,
      record_date: d.recordDate,
      pay_date: d.payDate,
      amount: d.amount,
      currency: d.currency,
      frequency: d.frequency,
      source: d.source,
    }));

    // Unique constraint is (security_id, ex_date, amount).
    const { error } = await supabase
      .from("dividends")
      .upsert(rows, { onConflict: "security_id,ex_date,amount" });
    if (error) throw error;
    inserted += rows.length;
  }

  return { inserted, skipped };
}
