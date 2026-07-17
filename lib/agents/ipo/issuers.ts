import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";
import type { RawFiling } from "@/lib/data-sources/types";
import { cleanIssuerName } from "./discovery";

/**
 * Pre-listing issuers live in `securities` like everything else — exchange
 * "IPO" marks them as not-yet-listed so the rest of the machinery (report
 * items, evidence, report page) works unchanged, while price-dependent
 * surfaces (portfolio search, refresh jobs, drop screens) skip them because
 * they scope by tag or real exchange.
 *
 * Identity is the SEC CIK (stored in the `classifications` jsonb), never the
 * ticker: a placeholder ticker is used until the prospectus discloses a
 * proposed symbol, and two issuers can even propose the same symbol — the
 * CIK is the only stable key.
 */

export interface IpoIssuerRow {
  securityId: string;
  cik: string;
  ticker: string;
}

interface SecurityRow {
  id: string;
  ticker: string;
  classifications: { cik?: string } | null;
}

/** Placeholder ticker until the prospectus discloses a proposed symbol. */
export function placeholderTicker(cik: string): string {
  return `CIK${String(parseInt(cik, 10))}`;
}

/**
 * Upsert one securities row per discovered issuer, keyed by CIK. Returns the
 * mapping the agent scores against. Individual failures are logged and the
 * issuer skipped — one bad row can't sink the run.
 */
export async function upsertIpoIssuers(
  filings: RawFiling[],
): Promise<Map<string, IpoIssuerRow>> {
  const out = new Map<string, IpoIssuerRow>();
  if (filings.length === 0) return out;
  const supabase = createServiceClient();

  // The IPO pipeline is small (≤ MAX_ISSUERS live at once) — load it whole
  // and match CIKs in memory rather than querying jsonb per issuer.
  const { data: existing, error } = await supabase
    .from("securities")
    .select("id, ticker, classifications")
    .eq("exchange", "IPO")
    .returns<SecurityRow[]>();
  if (error) throw new Error(`ipo issuers: ${getErrorMessage(error)}`);
  const byCik = new Map<string, SecurityRow>();
  for (const row of existing ?? []) {
    if (row.classifications?.cik) byCik.set(row.classifications.cik, row);
  }

  for (const filing of filings) {
    const cik = filing.issuerCik;
    if (!cik) continue;
    const name = cleanIssuerName(filing.issuerName ?? `CIK ${cik}`);
    try {
      const match = byCik.get(cik);
      if (match) {
        // Keep the name current (issuers rename); ticker updates happen
        // post-evaluation when a proposed symbol is known.
        await supabase.from("securities").update({ name }).eq("id", match.id);
        out.set(cik, { securityId: match.id, cik, ticker: match.ticker });
        continue;
      }
      const ticker = placeholderTicker(cik);
      const { data: inserted, error: insErr } = await supabase
        .from("securities")
        .insert({
          ticker,
          exchange: "IPO",
          name,
          country: filing.filingType.toUpperCase().startsWith("F-1") ? null : "US",
          asset_class: "equity",
          currency: "USD",
          tags: ["ipo_pipeline"],
          classifications: { cik },
        })
        .select("id")
        .single<{ id: string }>();
      if (insErr || !inserted) throw insErr ?? new Error("insert returned no row");
      out.set(cik, { securityId: inserted.id, cik, ticker });
    } catch (err) {
      console.warn(`ipo issuers: upsert failed for CIK ${cik}: ${getErrorMessage(err)}`);
    }
  }
  return out;
}

/**
 * Once an evaluation discloses a proposed listing symbol, promote it to the
 * display ticker. Best-effort: a unique-key collision (two issuers proposing
 * the same symbol) just keeps the placeholder.
 */
export async function applyProposedTicker(
  securityId: string,
  currentTicker: string,
  proposedTicker: string | null,
): Promise<string> {
  if (!proposedTicker || proposedTicker === currentTicker) return currentTicker;
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("securities")
      .update({ ticker: proposedTicker })
      .eq("id", securityId);
    if (error) throw error;
    return proposedTicker;
  } catch (err) {
    console.warn(
      `ipo issuers: could not apply proposed ticker ${proposedTicker}: ${getErrorMessage(err)}`,
    );
    return currentTicker;
  }
}
