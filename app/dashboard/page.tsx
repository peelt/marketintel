import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { agentRegistry } from "@/lib/agents/registry";
import { MODULE_COLORS, SiteHeader, Star } from "@/components/cli";
import type { AgentName } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedEmail(user.email)) {
    redirect("/login");
  }

  const agents = agentRegistry.list();

  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono-cli text-sm text-il-navy">~ the desk</div>
            <h1 className="mt-1 text-3xl font-bold text-il-navy">Dashboard</h1>
          </div>
          <form action={signOut}>
            <button type="submit" className="btn-cli-outline btn-cli-sm">
              sign out
            </button>
          </form>
        </div>

        <section className="mt-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <div
                key={a.name}
                className="card-cli card-cli-module p-6"
                style={{ "--module-color": MODULE_COLORS[a.name as AgentName] } as React.CSSProperties}
              >
                <div className="font-bold text-il-navy">{a.displayName}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {a.description}
                </p>
                <div className="mt-4 font-mono-cli text-xs text-muted-foreground">
                  ~ cron {a.schedule}
                </div>
              </div>
            ))}
          </div>
        </section>

        <hr className="divider-cli my-10" />

        <section className="grid gap-4 sm:grid-cols-3">
          <Link href="/reports" className="card-cli block p-6">
            <div className="font-mono-cli text-sm">
              <Star /> <span className="font-bold text-il-navy">reports</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Every filed report, ranked tables, evidence viewers.
            </p>
          </Link>
          <Link href="/dashboard/ops" className="card-cli block p-6">
            <div className="font-mono-cli text-sm">
              <Star /> <span className="font-bold text-il-navy">ops</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Click-through setup, data refresh and manual agent runs.
            </p>
          </Link>
          <Link href="/dashboard/diagnostics" className="card-cli block p-6">
            <div className="font-mono-cli text-sm">
              <Star /> <span className="font-bold text-il-navy">diagnostics</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Adapter readiness and row counts, at a glance.
            </p>
          </Link>
        </section>
      </main>
    </>
  );
}

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
