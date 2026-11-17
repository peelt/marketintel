import { cache } from "react";
import { agentRegistry } from "@/lib/agents/registry";
import { getErrorMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import {
  buildEditionIndexes,
  latestEdition,
  type EditionIndex,
  type EditionRowInput,
} from "./editions";

/**
 * Every succeeded report of every live desk, arranged as edition indexes —
 * ONE read per request.
 *
 * Zero-argument on purpose. The reports layout (navigator) and the reports
 * page (which edition is the latest?) both need it, and `cache()` keys on its
 * arguments: `createClient()` hands back a new client per call, so a loader
 * that took the client would never dedupe between the two.
 *
 * The ceiling is PostgREST's own page size. At one edition a trading day that
 * is roughly four years of filings; the previous list capped at 50 and quietly
 * dropped 40 of the 90 editions on file.
 */
const INDEX_CEILING = 1000;

/** The desk the reports page opens on when more than one is live. */
const PREFERRED_DESK = "reaction";

interface IndexRow {
  id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
  agent_runs: { status: string; trigger: string | null; input_params: unknown } | null;
}

export interface EditionIndexes {
  indexes: Record<string, EditionIndex>;
  /** The desk `/reports` opens on: the preferred one if it has editions. */
  primaryDesk: string | null;
}

export const loadEditionIndex = cache(async (): Promise<EditionIndexes> => {
  const supabase = await createClient();
  // Retired desks' editions stay in the database but are withdrawn from the
  // product (2026-07 scope reduction), and a failed or half-persisted run
  // must never read as an edition: live desks, succeeded runs only.
  const liveNames = agentRegistry
    .list()
    .filter((a) => a.status === "live")
    .map((a) => a.name);
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, agent_name, generated_at, summary_markdown, agent_runs!inner(status, trigger, input_params)",
    )
    .eq("agent_runs.status", "succeeded")
    .in("agent_name", liveNames)
    .order("generated_at", { ascending: false })
    .limit(INDEX_CEILING)
    .returns<IndexRow[]>();
  if (error) throw new Error(`loadEditionIndex: ${getErrorMessage(error)}`);

  const rows: EditionRowInput[] = (data ?? []).map((r) => ({
    id: r.id,
    agent_name: r.agent_name,
    generated_at: r.generated_at,
    summary_markdown: r.summary_markdown,
    trigger: r.agent_runs?.trigger ?? null,
    // Only the tickers are ever derived from this (see onDemandTickers); the
    // free-text `reason` beside them never leaves the server.
    input_params: r.agent_runs?.input_params ?? null,
  }));
  const indexes = buildEditionIndexes(rows);

  const withEditions = Object.keys(indexes).filter((d) => latestEdition(indexes[d]));
  const primaryDesk = withEditions.includes(PREFERRED_DESK)
    ? PREFERRED_DESK
    : (withEditions.sort((a, b) =>
        latestEdition(indexes[a])!.date < latestEdition(indexes[b])!.date ? 1 : -1,
      )[0] ?? null);
  return { indexes, primaryDesk };
});
