import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";
import { loadPortfolioIntel } from "@/lib/holdings/intel";
import { composeAlertEmail, type AlertItem } from "./compose";
import { sendEmail, postmarkReadiness } from "@/lib/email/postmark";

/**
 * Alert dispatch: after a report is filed, email each portfolio owner whose
 * HELD names the run flagged. Runs inside Inngest with the service client.
 *
 * Reuses the intel lens (loadPortfolioIntel + computeDelta) — the email and
 * the in-app feed share one delta engine, so they can never disagree about
 * what changed. An item alerts only when:
 *   - it belongs to the report that was JUST filed (no re-alerting on old
 *     state every time any desk runs), and
 *   - the delta says `attention` (a fresh flag or a worsening into one) —
 *     the same bar as the dashboard's "need a look" strip.
 *
 * Idempotent via alert_emails (unique report_id+user_id): insert-first, and
 * only the winner of the insert sends. Fail-soft throughout — alerting must
 * never fail the pipeline that produced the report.
 */

export interface DispatchResult {
  configured: boolean;
  portfolios: number;
  emailed: number;
  skipped: number;
}

interface PortfolioRow {
  id: string;
  user_id: string;
}

export async function dispatchHoldingAlerts(params: {
  reportId: string;
  agentName: string;
}): Promise<DispatchResult> {
  const { reportId, agentName } = params;
  const result: DispatchResult = {
    configured: postmarkReadiness() === null,
    portfolios: 0,
    emailed: 0,
    skipped: 0,
  };
  if (!result.configured) {
    console.warn("alerts: postmark not configured — skipping dispatch");
    return result;
  }

  const supabase = createServiceClient();
  const { data: portfolios, error } = await supabase
    .from("portfolios")
    .select("id, user_id")
    .returns<PortfolioRow[]>();
  if (error) {
    console.error(`alerts: portfolios load failed: ${getErrorMessage(error)}`);
    return result;
  }

  for (const portfolio of portfolios ?? []) {
    result.portfolios++;
    try {
      const intel = await loadPortfolioIntel(supabase, portfolio.id);
      const items: AlertItem[] = intel.items
        .filter(
          (i) =>
            i.agentName === agentName &&
            i.delta.attention &&
            i.delta.latest?.reportId === reportId,
        )
        .map((i) => ({
          ticker: i.ticker,
          name: i.name,
          agentDisplay: i.agentDisplay,
          delta: i.delta,
        }));
      if (items.length === 0) {
        result.skipped++;
        continue;
      }

      // Dedupe: only the run that wins the insert may send.
      const { data: claimed, error: claimErr } = await supabase
        .from("alert_emails")
        .upsert(
          {
            report_id: reportId,
            user_id: portfolio.user_id,
            item_count: items.length,
          },
          { onConflict: "report_id,user_id", ignoreDuplicates: true },
        )
        .select("id");
      if (claimErr) throw claimErr;
      if (!claimed || claimed.length === 0) {
        result.skipped++; // already alerted for this report
        continue;
      }

      const { data: userData, error: userErr } =
        await supabase.auth.admin.getUserById(portfolio.user_id);
      const to = userData?.user?.email;
      if (userErr || !to) {
        console.error(
          `alerts: no email for user ${portfolio.user_id}: ${getErrorMessage(userErr)}`,
        );
        result.skipped++;
        continue;
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://investorlogical.com";
      const composed = composeAlertEmail(items, appUrl);
      if (!composed) {
        result.skipped++;
        continue;
      }
      const sent = await sendEmail({ to, ...composed });
      if (sent) result.emailed++;
      else result.skipped++;
    } catch (err) {
      console.error(
        `alerts: dispatch failed for portfolio ${portfolio.id}: ${getErrorMessage(err)}`,
      );
      result.skipped++;
    }
  }
  return result;
}
