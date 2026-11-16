import type { SupabaseClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";
import { formatPrice } from "@/lib/format";
import { majorUnit } from "@/lib/holdings/valuation";

/**
 * The price behind a Reaction verdict: the closes the desk graded, as money.
 *
 * A verdict quotes its move as a percentage ("-25.6% over 5 sessions") and
 * the scores are relative, so a reader holding the name couldn't tie the
 * report to the price on their broker's screen. This builds the factual
 * frame for that: the close before the fall, the close the desk graded, the
 * 52-week high the repricing criterion measures against, and where the price
 * has gone since. Every figure is a stored close, nothing is modelled, and a
 * figure we can't support is null, never estimated (missing ≠ zero).
 *
 * Pure apart from `loadReactionPriceRows`, the one I/O function at the bottom.
 */

export interface PriceRowInput {
  date: string; // YYYY-MM-DD
  close: number;
  /** Provider currency as persisted ("USD", "GBp" = pence); null pre-0004. */
  currency: string | null;
}

export interface DatedClose {
  date: string;
  /** In the MAJOR unit (pence already converted to pounds). */
  close: number;
}

export interface ReactionPriceContext {
  /** ISO code of every close in this context, after pence → pounds. */
  currency: string;
  /**
   * The market QUOTES this name in pence (LSE "GBp"/"GBX"). The closes above
   * are in pounds, which keeps arithmetic safe, but a reader's UK broker
   * shows "53.40p", not "£0.53", and pounds at two decimals throws away the
   * pence precision. Display goes back to pence; see `priceFormatter`.
   */
  quotedInPence: boolean;
  /** The charted series: ~3 months before the screened close, to the latest. */
  chart: DatedClose[];
  /** The close the verdict graded. */
  screened: DatedClose;
  /** Start of the screened window (the close N sessions earlier), if on file. */
  windowStart: DatedClose | null;
  /**
   * Highest close in the year to the screened close, and how far below it the
   * screened close sat (a positive fraction). Null on under a year of history:
   * a "52-week high" from four months of data would understate the discount.
   */
  high52: (DatedClose & { belowFraction: number }) | null;
  /**
   * The newest close AFTER the screened one, with the move since. Null when
   * nothing has printed since the edition was filed.
   */
  latest: (DatedClose & { sinceFraction: number }) | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Calendar days of history charted before the screened close. */
export const CHART_LOOKBACK_DAYS = 92;
/** Calendar days the 52-week high looks back over. */
const HIGH_LOOKBACK_DAYS = 365;
/** History must reach back this far for the 52-week high to be honest. */
const HIGH_MIN_SPAN_DAYS = 330;
/**
 * The screened close must be on file within this many calendar days of the
 * date the verdict names — further than a long weekend plus a holiday and
 * the stored series has a hole exactly where the verdict sits.
 */
const SCREENED_MATCH_DAYS = 6;

export function shiftIsoDate(iso: string, days: number): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS,
  );
}

export function buildReactionPriceContext(
  rows: PriceRowInput[],
  opts: {
    /** The close the verdict graded (see resolveScreenedDate). */
    screenedDate: string;
    /** The screened window in trading sessions (1 or 5), if the verdict says. */
    sessions: number | null;
    /** The security's own currency, for rows ingested before 0004. */
    fallbackCurrency: string | null;
  },
): ReactionPriceContext | null {
  const screenedDate = opts.screenedDate.slice(0, 10);

  // Normalise every row on its OWN currency before anything is compared: a
  // series that straddles migration 0004 can mix a null currency with "GBp".
  const normalised: (DatedClose & { currency: string; pence: boolean })[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.close) || r.close <= 0) continue;
    const raw = r.currency ?? opts.fallbackCurrency;
    const m = majorUnit(r.close, raw);
    normalised.push({
      date: r.date.slice(0, 10),
      close: m.price,
      currency: m.currency,
      pence: m.price !== r.close,
    });
  }
  normalised.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // The screened close: the last session on or before the verdict's date.
  let idx = -1;
  for (let i = normalised.length - 1; i >= 0; i--) {
    if (normalised[i].date <= screenedDate) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const screenedRow = normalised[idx];
  if (daysBetween(screenedRow.date, screenedDate) > SCREENED_MATCH_DAYS) return null;

  // A currency change inside the series (a re-listing, a provider switch)
  // would make the figures incomparable. Keep only rows in the screened
  // close's currency rather than chart a fake 100× cliff.
  const series = normalised.filter((r) => r.currency === screenedRow.currency);
  const sIdx = series.findIndex((r) => r.date === screenedRow.date);
  const at = (r: DatedClose): DatedClose => ({ date: r.date, close: r.close });

  const screened = at(screenedRow);

  const windowStart =
    opts.sessions && opts.sessions > 0 && sIdx - opts.sessions >= 0
      ? at(series[sIdx - opts.sessions])
      : null;

  const yearAgo = shiftIsoDate(screened.date, -HIGH_LOOKBACK_DAYS);
  const year = series.slice(0, sIdx + 1).filter((r) => r.date > yearAgo);
  let high52: ReactionPriceContext["high52"] = null;
  if (year.length > 0 && daysBetween(year[0].date, screened.date) >= HIGH_MIN_SPAN_DAYS) {
    // Earliest date wins a tie, so the label names when the peak was first set.
    const peak = year.reduce((best, r) => (r.close > best.close ? r : best));
    high52 = { ...at(peak), belowFraction: 1 - screened.close / peak.close };
  }

  const last = series[series.length - 1];
  const latest =
    last.date > screened.date
      ? { ...at(last), sinceFraction: last.close / screened.close - 1 }
      : null;

  const chartFrom = shiftIsoDate(screened.date, -CHART_LOOKBACK_DAYS);
  const chart = series.filter((r) => r.date >= chartFrom).map(at);

  return {
    currency: screenedRow.currency,
    quotedInPence: screenedRow.pence,
    chart,
    screened,
    windowStart,
    high52,
    latest,
  };
}

/** How every price in a context is written: as the market quotes it. */
export function priceFormatter(
  ctx: Pick<ReactionPriceContext, "currency" | "quotedInPence">,
): (major: number) => string {
  if (!ctx.quotedInPence) return (v) => formatPrice(v, ctx.currency);
  const pence = new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Back from pounds; round first so 0.534 * 100 can't print 53.39999…
  return (v) => `${pence.format(Math.round(v * 10000) / 100)}p`;
}

/** The panel's currency caption: "USD", or "pence" for a pence quote. */
export function quoteCaption(
  ctx: Pick<ReactionPriceContext, "currency" | "quotedInPence">,
): string {
  return ctx.quotedInPence ? "pence" : ctx.currency;
}

/**
 * Horizontal position (0–1) of each charted close, by TRADING SESSION rather
 * than calendar date: weekends and holidays don't open gaps in the line, which
 * is how every broker draws a daily chart. Paired with the vertical position
 * (0 = top), padded so the extremes and the markers never touch the frame.
 */
export function chartGeometry(
  chart: DatedClose[],
  pad = 0.1,
): {
  min: number;
  max: number;
  x: (date: string) => number | null;
  y: (close: number) => number;
} {
  const closes = chart.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min;
  const index = new Map(chart.map((p, i) => [p.date, i]));
  const last = Math.max(1, chart.length - 1);
  return {
    min,
    max,
    x: (date) => {
      const i = index.get(date);
      return i === undefined ? null : i / last;
    },
    // A flat series sits mid-height rather than dividing by zero.
    y: (close) => (span === 0 ? 0.5 : pad + (1 - (close - min) / span) * (1 - 2 * pad)),
  };
}

/**
 * One parallel read per name — never a single `.in()` across the cohort: a
 * cohort's year of closes runs past PostgREST's 1,000-row page and would be
 * silently truncated, dropping the newest closes first.
 *
 * Bounded to a year before the earliest screened close and a year after the
 * latest, so a very old edition's read stays inside one page (~520 rows).
 * Fail-soft per name: a failed read is a missing panel, not a broken report.
 */
export async function loadReactionPriceRows(
  supabase: SupabaseClient,
  requests: { securityId: string; screenedDate: string }[],
): Promise<Map<string, PriceRowInput[] | null>> {
  const out = new Map<string, PriceRowInput[] | null>();
  await Promise.all(
    requests.map(async ({ securityId, screenedDate }) => {
      try {
        const { data, error } = await supabase
          .from("price_snapshots")
          .select("snapshot_date, close, currency")
          .eq("security_id", securityId)
          .gt("snapshot_date", shiftIsoDate(screenedDate, -HIGH_LOOKBACK_DAYS - 1))
          .lte("snapshot_date", shiftIsoDate(screenedDate, HIGH_LOOKBACK_DAYS))
          .order("snapshot_date", { ascending: true })
          .returns<{ snapshot_date: string; close: number | string; currency: string | null }[]>();
        if (error) throw new Error(error.message);
        out.set(
          securityId,
          (data ?? []).map((r) => ({
            date: r.snapshot_date,
            // numeric columns can arrive as strings; coerce once, here.
            close: Number(r.close),
            currency: r.currency,
          })),
        );
      } catch (err) {
        console.error(`reaction price rows (${securityId}): ${getErrorMessage(err)}`);
        out.set(securityId, null);
      }
    }),
  );
  return out;
}
