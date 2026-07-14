import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { Disclaimer } from "@/components/disclaimer";
import { PriceChart, type PricePoint } from "@/components/price-chart";

export const dynamic = "force-dynamic";

interface ReportRow {
  id: string;
  agent_run_id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
  body_markdown: string;
}

interface ReportItemRow {
  id: string;
  rank: number;
  security_id: string | null;
  composite_score: number;
  scoring_breakdown: {
    /** 0–1 share of framework weight that had data behind it. */
    coverage?: number;
    criteria?: Record<
      string,
      { score: number | null; signals: Record<string, number | null> }
    >;
  };
  verdict: string | null;
  classification: string | null;
  security: { ticker: string; exchange: string; name: string } | null;
}

interface EvidenceRow {
  id: string;
  report_item_id: string;
  evidence_type: string;
  source_table: string;
  source_text: string;
  weight: number;
  redistributable: boolean;
}

interface PriceHistoryRow {
  security_id: string;
  snapshot_date: string;
  close: number;
  currency: string | null;
}

interface RunRow {
  framework_id: string | null;
  framework: { version: number } | null;
  started_at: string;
  finished_at: string | null;
  status: string;
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) redirect("/login");

  const { data: report } = await supabase
    .from("reports")
    .select(
      "id, agent_run_id, agent_name, generated_at, summary_markdown, body_markdown",
    )
    .eq("id", id)
    .maybeSingle<ReportRow>();
  if (!report) notFound();

  const { data: run } = await supabase
    .from("agent_runs")
    .select(
      "framework_id, started_at, finished_at, status, framework:scoring_frameworks(version)",
    )
    .eq("id", report.agent_run_id)
    .maybeSingle<RunRow>();

  const { data: items } = await supabase
    .from("report_items")
    .select(
      "id, rank, security_id, composite_score, scoring_breakdown, verdict, classification, security:securities(ticker, exchange, name)",
    )
    .eq("report_id", report.id)
    .order("rank", { ascending: true })
    .returns<ReportItemRow[]>();

  // Evidence + 1y price history for the evidence viewer — the whole point of
  // the architecture (I1/I4): every score defensible from its cited rows.
  const itemIds = (items ?? []).map((i) => i.id);
  const securityIds = (items ?? [])
    .map((i) => i.security_id)
    .filter((v): v is string => v !== null);

  const [{ data: evidence }, { data: priceHistory }] = await Promise.all([
    itemIds.length
      ? supabase
          .from("evidence")
          .select(
            "id, report_item_id, evidence_type, source_table, source_text, weight, redistributable",
          )
          .in("report_item_id", itemIds)
          .order("weight", { ascending: false })
          .returns<EvidenceRow[]>()
      : Promise.resolve({ data: [] as EvidenceRow[] }),
    securityIds.length
      ? supabase
          .from("price_snapshots")
          .select("security_id, snapshot_date, close, currency")
          .in("security_id", securityIds)
          .gte(
            "snapshot_date",
            new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10),
          )
          .order("snapshot_date", { ascending: true })
          .returns<PriceHistoryRow[]>()
      : Promise.resolve({ data: [] as PriceHistoryRow[] }),
  ]);

  const evidenceByItem = new Map<string, EvidenceRow[]>();
  for (const ev of evidence ?? []) {
    const arr = evidenceByItem.get(ev.report_item_id) ?? [];
    arr.push(ev);
    evidenceByItem.set(ev.report_item_id, arr);
  }
  const pricesBySecurity = new Map<string, PriceHistoryRow[]>();
  for (const p of priceHistory ?? []) {
    const arr = pricesBySecurity.get(p.security_id) ?? [];
    arr.push(p);
    pricesBySecurity.set(p.security_id, arr);
  }

  const meta = agentRegistry.get(report.agent_name as AgentName);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex items-baseline justify-between">
        <Link
          href="/reports"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← reports
        </Link>
        <div className="text-right">
          <h1 className="text-2xl font-semibold tracking-tight">
            {meta?.displayName ?? report.agent_name}
          </h1>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {formatDate(report.generated_at)}
            {run?.framework?.version != null && (
              <> · framework v{run.framework.version}</>
            )}
          </div>
        </div>
      </header>

      {run && run.status !== "succeeded" && (
        <p className="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          This run finished with status <strong>{run.status}</strong> — the
          report below may be incomplete and is excluded from the reports list.
        </p>
      )}

      <article className="prose prose-sm mt-10 max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {report.body_markdown}
        </ReactMarkdown>
      </article>

      {items && items.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Ranked candidates
          </h2>
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-right">Composite</th>
                  <th className="px-3 py-2 text-right">Coverage</th>
                  <th className="px-3 py-2 text-left">Classification</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {it.rank}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {it.security?.ticker ?? "—"}
                      {it.security?.exchange && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {it.security.exchange}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{it.security?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {it.composite_score.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                      {it.scoring_breakdown?.coverage != null
                        ? `${Math.round(it.scoring_breakdown.coverage * 100)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {it.classification ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {items && items.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Evidence by candidate
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every score is defensible from the rows below — open a candidate to
            see exactly what the framework read.
          </p>
          <div className="mt-3 space-y-2">
            {items.map((it) => {
              const evidenceRows = evidenceByItem.get(it.id) ?? [];
              const prices = it.security_id
                ? (pricesBySecurity.get(it.security_id) ?? [])
                : [];
              const points: PricePoint[] = prices.map((p) => ({
                date: p.snapshot_date,
                close: p.close,
              }));
              const currency = prices.find((p) => p.currency)?.currency ?? null;
              const criteria = it.scoring_breakdown?.criteria ?? {};

              return (
                <details
                  key={it.id}
                  className="group rounded-md border border-border bg-card"
                >
                  <summary className="flex cursor-pointer items-baseline justify-between px-4 py-3 text-sm marker:content-none">
                    <span>
                      <span className="font-mono">{it.security?.ticker ?? "—"}</span>
                      <span className="ml-2 text-muted-foreground">
                        {it.security?.name ?? ""}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      #{it.rank} · {it.composite_score.toFixed(1)} ·{" "}
                      {evidenceRows.length} evidence row
                      {evidenceRows.length === 1 ? "" : "s"}
                    </span>
                  </summary>
                  <div className="border-t border-border px-4 py-4">
                    {it.verdict && (
                      <p className="mb-4 text-sm text-muted-foreground">
                        {it.verdict}
                      </p>
                    )}

                    {Object.keys(criteria).length > 0 && (
                      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {Object.entries(criteria).map(([key, c]) => (
                          <div
                            key={key}
                            className="rounded border border-border px-3 py-2"
                          >
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {key.replace(/_/g, " ")}
                            </div>
                            <div className="mt-1 font-mono text-sm">
                              {/* null = no data. NEVER render as 0. */}
                              {c.score === null ? (
                                <span className="text-muted-foreground">
                                  no data
                                </span>
                              ) : (
                                c.score.toFixed(1)
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {points.length >= 2 && (
                      <div className="mb-4">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                          Price — trailing year
                        </div>
                        <PriceChart points={points} currency={currency} />
                      </div>
                    )}

                    {evidenceRows.length > 0 ? (
                      <ul className="space-y-2">
                        {evidenceRows.map((ev) => (
                          <li
                            key={ev.id}
                            className="rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs"
                          >
                            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                              <span>{ev.evidence_type.replace(/_/g, " ")}</span>
                              <span>· confidence {ev.weight.toFixed(2)}</span>
                            </div>
                            <p className="leading-relaxed">{ev.source_text}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No evidence rows persisted for this candidate.
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      <Disclaimer />
    </main>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
