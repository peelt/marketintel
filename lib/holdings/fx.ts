import { z } from "zod";
import { httpFetch } from "@/lib/data-sources/http";
import { rateKey } from "./valuation";
import { getErrorMessage } from "@/lib/errors";

/**
 * FX rates for portfolio valuation, from Twelve Data's /exchange_rate endpoint
 * (same key as the price source; forex is on the free tier). Best-effort by
 * design: a pair we can't fetch is simply absent from the returned map, and the
 * valuation layer renders that holding in its native currency and flags the gap
 * rather than inventing a total (missing ≠ zero). A portfolio is usually one or
 * two currencies against the base, so this is a handful of calls at most.
 *
 * Process-cached keyed by pair — rates move slowly relative to a page load,
 * and we never want a valuation to fan out dozens of identical calls. The
 * cache carries a TTL so a long-lived serverless process doesn't keep serving
 * a rate for hours (the old comment said "request's lifetime" but the Map is
 * process-global); a mid-day move is picked up on the next fetch after expiry.
 */

const BASE = "https://api.twelvedata.com";
/** Cached rates expire after this long, so a long-lived process stays current. */
const FX_TTL_MS = 60 * 60 * 1000; // 1 hour

const RateZ = z.object({
  rate: z.number().optional(),
  symbol: z.string().optional(),
});

const cache = new Map<string, { rate: number; at: number }>();

function apiKey(): string | null {
  return process.env.TWELVEDATA_API_KEY || null;
}

/**
 * Fetch the rates for the given currency pairs. Returns a map keyed by
 * rateKey(from,to); pairs that fail are omitted (never defaulted). Identity
 * pairs are the caller's responsibility to skip (see requiredRatePairs).
 */
export async function fetchRates(
  pairs: Array<{ from: string; to: string }>,
): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  const key = apiKey();

  // Serve everything the process cache already holds, then fetch only what's
  // missing — IN PARALLEL. This loop used to await each pair in turn behind a
  // 200ms host throttle, inside a page render: a portfolio spanning three
  // currencies serialised three network calls before the page could finish.
  const missing: Array<{ from: string; to: string }> = [];
  for (const { from, to } of pairs) {
    const k = rateKey(from, to);
    const cached = cache.get(k);
    if (cached != null && Date.now() - cached.at < FX_TTL_MS) {
      rates.set(k, cached.rate);
      continue;
    }
    missing.push({ from, to });
  }
  if (!key || missing.length === 0) return rates; // no key → caller degrades

  const fetched = await Promise.all(
    missing.map(async ({ from, to }) => {
      try {
        const url = `${BASE}/exchange_rate?symbol=${encodeURIComponent(
          `${from}/${to}`,
        )}&apikey=${key}`;
        const res = await httpFetch(url, { hostThrottleMs: 200 });
        if (!res.ok) return null;
        const parsed = RateZ.safeParse(await res.json());
        if (parsed.success && typeof parsed.data.rate === "number") {
          return { k: rateKey(from, to), rate: parsed.data.rate };
        }
      } catch (err) {
        // Best-effort: log-and-skip, never throw into a page render.
        console.warn(`fx: ${from}/${to} unavailable — ${getErrorMessage(err)}`);
      }
      return null;
    }),
  );
  for (const r of fetched) {
    if (!r) continue;
    cache.set(r.k, { rate: r.rate, at: Date.now() });
    rates.set(r.k, r.rate);
  }

  return rates;
}

/** Test seam: clear the process cache. */
export function clearFxCache(): void {
  cache.clear();
}
