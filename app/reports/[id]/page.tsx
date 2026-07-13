import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";

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
      "id, rank, composite_score, scoring_breakdown, verdict, classification, security:securities(ticker, exchange, name)",
    )
    .eq("report_id", report.id)
    .order("rank", { ascending: true })
    .returns<ReportItemRow[]>();

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
