"use server";

import { createClient } from "@/lib/supabase/server";
import { isEntitledEmail } from "@/lib/auth/entitlement";
import { loadReactionFeed } from "@/lib/reports/reaction-feed";
import { getErrorMessage } from "@/lib/errors";

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
}

const TICKER_RE = /^[A-Za-z0-9.\-]{1,12}$/;

export async function requestDropAnalysis(
  _prev: DropAnalysisState,
  formData: FormData,
): Promise<DropAnalysisState> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !(await isEntitledEmail(user.email))) {
      return { status: "error", message: "Sign in to request an analysis." };
    }

    const ticker = String(formData.get("ticker") ?? "")
      .trim()
      .toUpperCase();
    if (!TICKER_RE.test(ticker)) {
      return {
        status: "error",
        message: "Enter a ticker, e.g. NVDA or NXT.L.",
      };
    }

    // Reaction only screens the broad universe — say so up front rather than
    // queuing a run that can only report "not tracked".
    const { data: security, error: secErr } = await supabase
      .from("securities")
      .select("id, ticker")
      .eq("ticker", ticker)
      .contains("tags", ["broad_market"])
      .is("delisted_at", null)
      .limit(1)
      .maybeSingle<{ id: string; ticker: string }>();
    if (secErr) throw new Error(getErrorMessage(secErr));
    if (!security) {
      return {
        status: "error",
        message: `${ticker} isn't in the Reaction universe (S&P 500 + FTSE 350).`,
      };
    }

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
    };
  } catch (err) {
    return { status: "error", message: getErrorMessage(err) };
  }
}
