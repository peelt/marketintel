import { createServiceClient } from "@/lib/supabase/service";
import { resolveSecurityId } from "./resolve-security";
import type { RawFinancialsSnapshot } from "@/lib/data-sources/types";

export async function ingestFinancials(
  snapshots: RawFinancialsSnapshot[],
): Promise<{ inserted: number; skipped: number }> {
  if (snapshots.length === 0) return { inserted: 0, skipped: 0 };
  const supabase = createServiceClient();

  let inserted = 0;
  let skipped = 0;

  for (const s of snapshots) {
    const securityId = await resolveSecurityId(s.ticker, s.exchange);
    if (!securityId) {
      skipped++;
      continue;
    }
    const { error } = await supabase
      .from("financials_snapshot")
      .upsert(
        {
          security_id: securityId,
          period_end: s.periodEnd,
          period_type: s.periodType,
          fiscal_period: s.fiscalPeriod,
          revenue: s.revenue,
          gross_profit: s.grossProfit,
          operating_income: s.operatingIncome,
          ebitda: s.ebitda,
          net_income: s.netIncome,
          eps_diluted: s.epsDiluted,
          total_assets: s.totalAssets,
          total_debt: s.totalDebt,
          cash_and_equivalents: s.cashAndEquivalents,
          shareholders_equity: s.shareholdersEquity,
          operating_cash_flow: s.operatingCashFlow,
          capex: s.capex,
          free_cash_flow: s.freeCashFlow,
          dividends_paid: s.dividendsPaid,
          market_cap: s.marketCap,
          enterprise_value: s.enterpriseValue,
          shares_outstanding: s.sharesOutstanding,
          source: s.source,
          source_url: s.sourceUrl,
          raw: s.raw,
        },
        { onConflict: "security_id,period_end,period_type,source" },
      );
    if (error) throw error;
    inserted++;
  }

  return { inserted, skipped };
}
