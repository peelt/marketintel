import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { agentRegistry } from "@/lib/agents/registry";
import type { AgentName } from "@/lib/agents/types";
import { Disclaimer } from "@/components/disclaimer";

export const dynamic = "force-dynamic";

interface ReportRow {
  id: string;
  agent_name: string;
  generated_at: string;
  summary_markdown: string;
  agent_runs: { status: string } | null;
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) redirect("/login");

  // Inner-join on the run and filter to succeeded — failed or half-persisted
  // runs must never render as legitimate reports.
  const { data: reports } = await supabase
    .from("reports")
    .select("id, agent_name, generated_at, summary_markdown, agent_runs!inner(status)")
    .eq("agent_runs.status", "succeeded")
    .order("generated_at", { ascending: false })
    .limit(50)
    .returns<ReportRow[]>();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <Link
          href="/dashboard"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← dashboard
        </Link>
      </header>

      {!reports?.length ? (
        <p className="mt-10 text-sm text-muted-foreground">
          No reports yet. Agents will start producing reports once they&apos;re
          wired up in PR 4 onwards.
        </p>
      ) : (
        <ul className="mt-8 space-y-2">
          {reports.map((r) => {
            const meta = agentRegistry.get(r.agent_name as AgentName);
            return (
              <li key={r.id}>
                <Link
                  href={`/reports/${r.id}`}
                  className="block rounded-md border border-border bg-card px-4 py-3 hover:border-accent"
                >
                  <div className="flex items-baseline justify-between">
                    <div className="text-sm font-medium">
                      {meta?.displayName ?? r.agent_name}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {formatDate(r.generated_at)}
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {firstLine(r.summary_markdown)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Disclaimer />
    </main>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function firstLine(markdown: string): string {
  const lines = markdown.split("\n").filter((l) => l.trim().length > 0);
  return lines[0]?.replace(/^#+\s*/, "").slice(0, 200) ?? "";
}
