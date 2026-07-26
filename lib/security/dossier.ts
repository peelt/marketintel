import type { SupabaseClient } from "@supabase/supabase-js";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { getErrorMessage } from "@/lib/errors";
import { computeDelta, severityOf, type Delta, type VerdictSnapshot } from "@/lib/holdings/deltas";

/**
 * The per-security dossier — one page per tracked name that gathers EVERY
 * desk's latest read on it in one place, with price and a link out to each
 * report for the evidence. This is the security-first projection the product
 * was missing: reports are editions, but a reader thinks in companies.
 *
 * Reads run under the caller's RLS session (report_items + price_snapshots are
 * entitled-read). Evidence is NOT duplicated here — each desk row links to its
 * report, where the cited rows already live.
 */

export interface DeskVerdict {
  agentName: string;
  agentDisplay: string;
  moduleColor: string;
  classification: string | null;
  composite: number | null;
  coverage: number | null;
  verdict: string | null;
  reportId: string;
  generatedAt: string;
  /** Change vs this desk's previous edition on this name. */
  delta: Delta;
}

export interface SecurityHeader {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  subSector: string | null;
  currency: string | null;
  delistedAt: string | null;
}

export interface SecurityDossier {
  security: SecurityHeader;
  desks: DeskVerdict[];
  prices: { date: string; close: number; currency: string | null }[];
}

interface SecurityRow {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  sub_sector: string | null;
  currency: string | null;
  delisted_at: string | null;
}

interface VerdictRow {
  classification: string | null;
  composite_score: number;
  scoring_breakdown: { coverage?: number } | null;
  verdict: string | null;
  report: {
    id: string;
    agent_name: string;
    generated_at: string;
    agent_runs: { status: string } | null;
  } | null;
}

interface PriceRow {
  snapshot_date: string;
  close: number;
  currency: string | null;
}

/**
 * Bucket a security's verdict rows by desk, newest first, and reduce each desk
 * to its latest verdict + the delta vs its previous edition. Ordered
 * most-concerning desk first so a flag leads. Pure — unit-tested.
 */
export function rankDeskVerdicts(
  rows: VerdictRow[],
  colorOf: (agentName: string) => string,
  displayOf: (agentName: string) => string,
): DeskVerdict[] {
  const buckets = new Map<string, VerdictSnapshot[]>();
  for (const v of rows) {
    if (!v.report) continue;
    const arr = buckets.get(v.report.agent_name) ?? [];
    arr.push({
      agentName: v.report.agent_name,
      classification: v.classification,
      composite: v.composite_score,
      coverage: v.scoring_breakdown?.coverage ?? null,
      runAt: v.report.generated_at,
      reportId: v.report.id,
    });
    buckets.set(v.report.agent_name, arr);
  }

  const desks: DeskVerdict[] = [];
  for (const [agentName, snaps] of buckets) {
    snaps.sort((a, b) => b.runAt.localeCompare(a.runAt));
    const latest = snaps[0];
    const previous = snaps[1] ?? null;
    // Carry the verdict text from the row matching the latest snapshot.
    const latestRow = rows.find(
      (r) =>
        r.report?.agent_name === agentName &&
        r.report?.generated_at === latest.runAt,
    );
    desks.push({
      agentName,
      agentDisplay: displayOf(agentName),
      moduleColor: colorOf(agentName),
      classification: latest.classification,
      composite: latest.composite,
      coverage: latest.coverage,
      verdict: latestRow?.verdict ?? null,
      reportId: latest.reportId ?? "",
      generatedAt: latest.runAt,
      delta: computeDelta(latest, previous),
    });
  }

  // Most-concerning desk first; ties by recency.
  desks.sort((a, b) => {
    const ra = severityOf(a.classification).rank;
    const rb = severityOf(b.classification).rank;
    if (rb !== ra) return rb - ra;
    return b.generatedAt.localeCompare(a.generatedAt);
  });
  return desks;
}

export async function loadSecurityDossier(
  supabase: SupabaseClient,
  securityId: string,
  colors: Record<string, string>,
): Promise<SecurityDossier | null> {
  const { data: security, error: secErr } = await supabase
    .from("securities")
    .select("id, ticker, exchange, name, sector, sub_sector, currency, delisted_at")
    .eq("id", securityId)
    .maybeSingle<SecurityRow>();
  if (secErr) throw new Error(`dossier security: ${getErrorMessage(secErr)}`);
  if (!security) return null;

  // 180 days covers "latest + previous" for every desk cadence (weekly desks
  // included) so each desk row can show a delta.
  const sinceIso = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: verdicts, error: vErr }, { data: prices, error: pErr }] =
    await Promise.all([
      supabase
        .from("report_items")
        .select(
          "classification, composite_score, scoring_breakdown, verdict, report:reports!inner(id, agent_name, generated_at, agent_runs!inner(status))",
        )
        .eq("security_id", securityId)
        .eq("report.agent_runs.status", "succeeded")
        .gte("report.generated_at", sinceIso)
        .order("id", { ascending: false })
        .returns<VerdictRow[]>(),
      supabase
        .from("price_snapshots")
        .select("snapshot_date, close, currency")
        .eq("security_id", securityId)
        .gte(
          "snapshot_date",
          new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10),
        )
        .order("snapshot_date", { ascending: true })
        .returns<PriceRow[]>(),
    ]);
  if (vErr) throw new Error(`dossier verdicts: ${getErrorMessage(vErr)}`);
  if (pErr) throw new Error(`dossier prices: ${getErrorMessage(pErr)}`);

  // Retired desks' verdicts are withdrawn from the product (2026-07 scope
  // reduction) — a dossier row would link to a report page that now 404s.
  const liveVerdicts = (verdicts ?? []).filter(
    (v) =>
      v.report &&
      agentRegistry.get(v.report.agent_name as AgentName)?.status === "live",
  );

  const displayOf = (agentName: string) =>
    agentRegistry.get(agentName as AgentName)?.displayName ?? agentName;
  const colorOf = (agentName: string) => colors[agentName] ?? "#034566";

  return {
    security: {
      id: security.id,
      ticker: security.ticker,
      exchange: security.exchange,
      name: security.name,
      sector: security.sector,
      subSector: security.sub_sector,
      currency: security.currency,
      delistedAt: security.delisted_at,
    },
    desks: rankDeskVerdicts(liveVerdicts, colorOf, displayOf),
    prices: (prices ?? []).map((p) => ({
      date: p.snapshot_date,
      close: p.close,
      currency: p.currency,
    })),
  };
}
