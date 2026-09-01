import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";

/**
 * A desk's most recent succeeded editions, resolved once per request.
 *
 * The dashboard needs the same `reports` rows three times over: the desk card
 * wants the latest two (headline + delta baseline), and the rolling 48h feed
 * wanted both "the newest edition ever" and "every edition inside the window".
 * Those were three separate round-trips against one small, identical result
 * set. One newest-first read serves all three; callers slice or filter.
 */

export interface DeskReportRow {
  id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
}

/**
 * How many editions to hold. Comfortably covers the desk card (2) and any
 * 48h window at a daily cadence, with room for on-demand runs. If a window
 * ever exceeded this, the feed would simply draw from the newest N — it
 * renders at most 6 drops.
 */
const RECENT_LIMIT = 15;

export const loadRecentDeskReports = cache(
  async (
    supabase: SupabaseClient,
    agentName: string,
  ): Promise<DeskReportRow[]> => {
    const { data, error } = await supabase
      .from("reports")
      .select(
        "id, agent_name, generated_at, summary_markdown, agent_runs!inner(status)",
      )
      .eq("agent_name", agentName)
      .eq("agent_runs.status", "succeeded")
      .order("generated_at", { ascending: false })
      .limit(RECENT_LIMIT)
      .returns<DeskReportRow[]>();
    if (error) {
      throw new Error(`loadRecentDeskReports(${agentName}): ${getErrorMessage(error)}`);
    }
    return data ?? [];
  },
);
