"use server";

import { createClient } from "@/lib/supabase/server";
import { isEntitledEmail } from "@/lib/auth/entitlement";
import { loadReactionFeed } from "@/lib/reports/reaction-feed";
import { getErrorMessage } from "@/lib/errors";
import { verifyUser } from "@/lib/auth/verify";
import {
  normaliseQuery,
  type SearchableSecurity,
} from "@/lib/reaction/ticker-search";

/**
 * On-demand Reaction analysis — the hero interaction: "this name just fell,
 * analyse it". The action validates against the tracked universe and QUEUES the
 * run via Inngest (`agent/run.requested` + tickers scope); nothing here touches
 * the service-role client — the write side runs entirely inside the Inngest
 * function, per the security model.
 */

export interface DropAnalysisState {
  status: "idle" | "started" | "already" | "error";
  message: string;
  /** Set when the answer already exists — link straight to it. */
  reportId?: string;
  /** The canonical ticker that was queued, for the client to poll on. */
  ticker?: string;
  /** When it was queued; the poll only looks at reports filed after this. */
  queuedAt?: string;
}

const TICKER_RE = /^[A-Za-z0-9.\-]{1,12}$/;

/** The RLS client for an entitled caller, or null. */
async function entitledClient() {
  const supabase = await createClient();
  const user = await verifyUser(supabase);
  if (!user || !(await isEntitledEmail(user.email))) return null;
  return supabase;
}

/**
 * The Reaction universe as a searchable list — every name the desk can be
 * asked about. Fetched ONCE by the analyse form on first focus and ranked in
 * the browser (lib/reaction/ticker-search.ts); at ~850 names it is ~9KB
 * gzipped, cheaper than a single per-keystroke round-trip. Process-cached:
 * the universe changes on seed, not per request. Read under RLS; the list is
 * public product data, not anything user-specific.
 */
const UNIVERSE_TTL_MS = 10 * 60 * 1000;
let universeCache: { at: number; rows: SearchableSecurity[] } | null = null;

export async function loadReactionUniverse(): Promise<
  { ok: true; data: SearchableSecurity[] } | { ok: false; error: string }
> {
  try {
    const supabase = await entitledClient();
    if (!supabase) return { ok: false, error: "not authorized" };
    if (universeCache && Date.now() - universeCache.at < UNIVERSE_TTL_MS) {
      return { ok: true, data: universeCache.rows };
    }
    const { data, error } = await supabase
      .from("securities")
      .select("id, ticker, exchange, name")
      .contains("tags", ["broad_market"])
      .is("delisted_at", null)
      .order("ticker", { ascending: true })
      .limit(2000)
      .returns<SearchableSecurity[]>();
    if (error) throw new Error(getErrorMessage(error));
    const rows = data ?? [];
    if (rows.length > 0) universeCache = { at: Date.now(), rows };
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

/**
 * Has the on-demand run for `ticker` filed its report yet?
 *
 * The queued message used to promise a report and then leave the reader with
 * nowhere to go: the report doesn't exist when the action returns, so it can't
 * be linked. The form polls this instead and swaps in a link when it lands.
 *
 * Matched on the RUN, not on a report item: a name that turns out not to clear
 * the screen still gets a report saying so, and would have no scored row to
 * find. `input_params.tickers` is what the queue wrote, so it identifies the
 * run precisely; the time bound keeps an older run for the same name out.
 */
export async function findOnDemandReport(
  ticker: string,
  sinceIso: string,
): Promise<{ reportId: string | null }> {
  try {
    const supabase = await entitledClient();
    if (!supabase) return { reportId: null };
    const wanted = ticker.trim().toUpperCase();
    if (!wanted || Number.isNaN(Date.parse(sinceIso))) return { reportId: null };

    const { data, error } = await supabase
      .from("reports")
      .select("id, generated_at, agent_runs!inner(status, input_params)")
      .eq("agent_name", "reaction")
      .eq("agent_runs.status", "succeeded")
      .gte("generated_at", sinceIso)
      .order("generated_at", { ascending: false })
      .limit(10)
      .returns<
        {
          id: string;
          generated_at: string;
          agent_runs: { status: string; input_params: { tickers?: string[] } | null };
        }[]
      >();
    if (error) throw new Error(getErrorMessage(error));

    const hit = (data ?? []).find((r) =>
      (r.agent_runs?.input_params?.tickers ?? []).some(
        (t) => String(t).trim().toUpperCase() === wanted,
      ),
    );
    return { reportId: hit?.id ?? null };
  } catch (err) {
    // Polling must never surface an error into the form; the reader still has
    // the reports list.
    console.error(`findOnDemandReport: ${getErrorMessage(err)}`);
    return { reportId: null };
  }
}

export async function requestDropAnalysis(
  _prev: DropAnalysisState,
  formData: FormData,
): Promise<DropAnalysisState> {
  try {
    const supabase = await entitledClient();
    if (!supabase) {
      return { status: "error", message: "Sign in to request an analysis." };
    }

    const rawTicker = String(formData.get("ticker") ?? "").trim();
    if (!TICKER_RE.test(rawTicker)) {
      return {
        status: "error",
        message: "Pick a name from the list, or enter a ticker like NVDA or NXT.L.",
      };
    }
    // Tickers are stored WITHOUT the London ".L" suffix; accept it anyway —
    // the placeholder's own example uses it.
    const typed = normaliseQuery(rawTicker).term;

    // Reaction only screens the broad universe — say so up front rather than
    // queuing a run that can only report "not tracked". A selection from the
    // live search arrives as securityId; it is client input, so the universe
    // predicate is enforced on it exactly as on a typed ticker.
    const securityId = String(formData.get("securityId") ?? "").trim();
    let lookup = supabase
      .from("securities")
      .select("id, ticker")
      .contains("tags", ["broad_market"])
      .is("delisted_at", null);
    lookup = securityId ? lookup.eq("id", securityId) : lookup.eq("ticker", typed);
    const { data: security, error: secErr } = await lookup
      .limit(1)
      .maybeSingle<{ id: string; ticker: string }>();
    if (secErr) throw new Error(getErrorMessage(secErr));
    if (!security) {
      return {
        status: "error",
        message: `No name matching "${rawTicker.toUpperCase()}" in the Reaction universe (S&P 500 + FTSE 350) — start typing to pick from the list.`,
      };
    }
    // The stored symbol is canonical from here on, however it was found.
    const ticker = security.ticker.toUpperCase();

    // Screened in the last 24h already? Point at the existing verdict instead
    // of burning a duplicate research run.
    const feed = await loadReactionFeed(supabase);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const existing = feed.drops.find(
      (d) =>
        d.ticker.toUpperCase() === ticker &&
        new Date(d.screenedAt).getTime() >= dayAgo,
    );
    if (existing) {
      return {
        status: "already",
        message: `${ticker} was screened in the last 24 hours — its verdict is already filed.`,
        reportId: existing.reportId,
      };
    }

    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
      name: "agent/run.requested",
      data: {
        agentName: "reaction",
        reason: `on-demand: ${ticker} requested from the dashboard`,
        tickers: [ticker],
      },
    });
    return {
      status: "started",
      message: `${ticker} queued — the desk screens it against the latest closes and files a report in a few minutes.`,
      ticker,
      queuedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { status: "error", message: getErrorMessage(err) };
  }
}
