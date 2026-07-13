import { createServiceClient } from "@/lib/supabase/service";
import type { RawMacroObservation } from "@/lib/data-sources/types";

export async function ingestMacro(
  observations: RawMacroObservation[],
): Promise<{ inserted: number }> {
  if (observations.length === 0) return { inserted: 0 };
  const supabase = createServiceClient();

  const rows = observations.map((o) => ({
    series_id: o.seriesId,
    source: o.source,
    observed_at: o.observedAt,
    value: o.value,
    units: o.units,
  }));

  const { error } = await supabase
    .from("macro_indicators")
    .upsert(rows, { onConflict: "series_id,source,observed_at" });
  if (error) throw error;
  return { inserted: rows.length };
}
