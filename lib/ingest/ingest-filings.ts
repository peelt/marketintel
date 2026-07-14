import { createServiceClient } from "@/lib/supabase/service";
import { resolveSecurityId } from "./resolve-security";
import { dedupeBy } from "./dedupe";
import type { RawFiling } from "@/lib/data-sources/types";

/**
 * Ingest filing metadata. Full-text extraction and sectioning is deferred to
 * the IPO agent (PR 5) since it's expensive and only needed for filings the
 * scorer actually reads.
 */
export async function ingestFilings(
  filings: RawFiling[],
): Promise<{ inserted: number; skipped: number }> {
  if (filings.length === 0) return { inserted: 0, skipped: 0 };
  const supabase = createServiceClient();

  let inserted = 0;
  let skipped = 0;

  // Dedupe key is (source, accession_number); URL stands in for sources
  // without accession numbers (migration 0004 made the column not-null).
  const unique = dedupeBy(filings, (f) => `${f.source}::${f.accessionNumber ?? f.url}`);

  for (const f of unique) {
    let securityId: string | null = null;
    if (f.ticker && f.exchange) {
      securityId = await resolveSecurityId(f.ticker, f.exchange);
    }

    const row = {
      security_id: securityId,
      issuer_name: f.issuerName,
      issuer_cik: f.issuerCik,
      source: f.source,
      filing_type: f.filingType,
      filed_at: f.filedAt,
      period_end: f.periodEnd,
      url: f.url,
      accession_number: f.accessionNumber ?? f.url,
      raw_text: f.rawText,
    };

    // Conflict on (source, accession_number) — set in the migration.
    const { error } = await supabase
      .from("filings")
      .upsert(row, {
        onConflict: "source,accession_number",
        ignoreDuplicates: true,
      });
    if (error) {
      skipped++;
      continue;
    }
    inserted++;
  }

  return { inserted, skipped };
}
