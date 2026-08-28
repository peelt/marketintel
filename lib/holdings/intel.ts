import type { SupabaseClient } from "@supabase/supabase-js";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { loadHeldVerdictRows, loadHoldingRows } from "./data";
import {
  computeDelta,
  severityOf,
  summarizeHealth,
  type Delta,
  type PortfolioHealth,
  type VerdictSnapshot,
} from "./deltas";

/**
 * Portfolio intel lens (6b). For each held name, load its latest and previous
 * verdict from EACH desk that covers it, diff them, and surface what changed —
 * the point of holdings. Runs under the caller's RLS session; report_items are
 * entitled-read, holdings user-scoped. Reads only; alerting-on-schedule (email)
 * is a follow-up that needs an email provider decision.
 */

export interface IntelItem {
  securityId: string;
  ticker: string;
  name: string;
  agentName: string;
  agentDisplay: string;
  delta: Delta;
}

export interface PortfolioIntel {
  /** Per (held name × desk covering it), sorted attention-first upstream. */
  items: IntelItem[];
  attentionCount: number;
  /** One entry per held name (its single most-concerning current verdict). */
  health: PortfolioHealth;
}

export async function loadPortfolioIntel(
  supabase: SupabaseClient,
  portfolioId: string,
): Promise<PortfolioIntel> {
  // Shared with the valuation path (lib/holdings/data.ts) — one holdings read
  // per request, not one per consumer.
  const rows = await loadHoldingRows(supabase, portfolioId);
  if (rows.length === 0) {
    return { items: [], attentionCount: 0, health: summarizeHealth([]) };
  }

  // Distinct held securities (lots collapse to one security for intel).
  const nameBysecurity = new Map<string, string>();
  const tickerBySecurity = new Map<string, string>();
  for (const h of rows) {
    tickerBySecurity.set(h.security_id, h.security?.ticker ?? "—");
    nameBysecurity.set(h.security_id, h.security?.name ?? "");
  }
  const securityIds = [...tickerBySecurity.keys()];

  // Recent succeeded verdicts for the held names. 90 days covers "latest +
  // previous" for the daily Reaction Analyser. The rows come from the shared
  // 120-day fetch (lib/holdings/data.ts) that the valuation path already
  // needs, narrowed here rather than paginated a second time.
  const sinceIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const allVerdicts = await loadHeldVerdictRows(supabase, portfolioId);
  const verdicts = allVerdicts.filter(
    (v) => (v.report?.generated_at ?? "") >= sinceIso,
  );

  // Bucket by (security, agent), newest first. Retired desks' verdicts are
  // withdrawn from the product (2026-07 scope reduction) — surfacing a delta
  // from a desk that no longer files would point at content the reports
  // pages no longer serve.
  const buckets = new Map<string, VerdictSnapshot[]>();
  for (const v of verdicts ?? []) {
    if (!v.security_id || !v.report) continue;
    if (
      agentRegistry.get(v.report.agent_name as AgentName)?.status !== "live"
    ) {
      continue;
    }
    const key = `${v.security_id}::${v.report.agent_name}`;
    const arr = buckets.get(key) ?? [];
    arr.push({
      agentName: v.report.agent_name,
      classification: v.classification,
      composite: v.composite_score,
      coverage: v.scoring_breakdown?.coverage ?? null,
      runAt: v.report.generated_at,
      reportId: v.report.id,
    });
    buckets.set(key, arr);
  }

  const items: IntelItem[] = [];
  // Most-concerning current classification per held name (for the health roll-up).
  const topByName = new Map<string, string | null>();

  for (const [key, snaps] of buckets) {
    snaps.sort((a, b) => b.runAt.localeCompare(a.runAt));
    const [latest, previous] = [snaps[0] ?? null, snaps[1] ?? null];
    const securityId = key.split("::")[0];
    const agentName = latest?.agentName ?? previous?.agentName ?? "";
    const meta = agentRegistry.get(agentName as AgentName);

    items.push({
      securityId,
      ticker: tickerBySecurity.get(securityId) ?? "—",
      name: nameBysecurity.get(securityId) ?? "",
      agentName,
      agentDisplay: meta?.displayName ?? agentName,
      delta: computeDelta(latest, previous),
    });

    // Track the most-concerning current classification for this name.
    if (latest?.classification) {
      const current = topByName.get(securityId) ?? null;
      if (
        current === null ||
        severityOf(latest.classification).rank > severityOf(current).rank
      ) {
        topByName.set(securityId, latest.classification);
      }
    } else if (!topByName.has(securityId)) {
      topByName.set(securityId, null);
    }
  }

  // Held names with no verdict at all still count as "uncovered" in health.
  for (const securityId of securityIds) {
    if (!topByName.has(securityId)) topByName.set(securityId, null);
  }

  const attentionCount = items.filter((i) => i.delta.attention).length;
  const health = summarizeHealth(
    [...topByName.values()].map((classification) => ({ classification })),
  );

  return { items, attentionCount, health };
}
