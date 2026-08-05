import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";
import type { SessionRow } from "./metrics";
import type { PriorFlag } from "./agent";

/**
 * When was each of these names FIRST flagged as an overshoot in a recent
 * edition, and what has price done since?
 *
 * The framework re-flags a name while its 5-session window still spans the
 * fall, so an edition can repeat an overshoot call after the bounce it
 * predicted has already happened. Surfacing the move since the first flag
 * keeps the repeat honest. Service-role read — Inngest/agent contexts only.
 *
 * Fail-soft by design: if this read fails, verdicts simply omit the context
 * line. A missing annotation must never fail a run.
 */

const LOOKBACK_DAYS = 30;
const OVERSHOOT_BANDS = ["strong_overshoot", "mild_overshoot"];

interface Row {
  security_id: string;
  report: { generated_at: string } | null;
}

/** Return per security-id: the earliest overshoot flag inside the window. */
export async function loadPriorOvershootFlags(
  securityIds: string[],
  series: Map<string, SessionRow[]>,
): Promise<Map<string, PriorFlag>> {
  const out = new Map<string, PriorFlag>();
  if (securityIds.length === 0) return out;

  try {
    const supabase = createServiceClient();
    const sinceIso = new Date(
      Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("report_items")
      .select("security_id, report:reports!inner(generated_at, agent_name, agent_runs!inner(status))")
      .in("security_id", securityIds)
      .in("classification", OVERSHOOT_BANDS)
      .eq("report.agent_name", "reaction")
      .eq("report.agent_runs.status", "succeeded")
      .gte("report.generated_at", sinceIso)
      .returns<Row[]>();
    if (error) throw new Error(getErrorMessage(error));

    // Earliest flag per security.
    const earliest = new Map<string, string>();
    for (const r of data ?? []) {
      const at = r.report?.generated_at?.slice(0, 10);
      if (!at) continue;
      const prev = earliest.get(r.security_id);
      if (!prev || at < prev) earliest.set(r.security_id, at);
    }

    for (const [securityId, firstFlaggedAt] of earliest) {
      out.set(securityId, {
        firstFlaggedAt,
        returnSince: returnSinceDate(series.get(securityId) ?? [], firstFlaggedAt),
      });
    }
  } catch (err) {
    console.warn(`loadPriorOvershootFlags skipped: ${getErrorMessage(err)}`);
  }
  return out;
}

/**
 * Fractional return from the close on (or last before) `fromDate` to the
 * latest close. Null when the series can't support it — never 0. Pure;
 * exported for tests.
 */
export function returnSinceDate(
  series: SessionRow[],
  fromDate: string,
): number | null {
  if (series.length === 0) return null;
  let baseIdx = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= fromDate) {
      baseIdx = i;
      break;
    }
  }
  if (baseIdx < 0 || baseIdx === series.length - 1) return null;
  const base = series[baseIdx].close;
  if (base <= 0) return null;
  return series[series.length - 1].close / base - 1;
}
