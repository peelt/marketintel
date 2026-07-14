import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { agentRegistry } from "@/lib/agents/registry";

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
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <form action={signOut}>
          <button
            type="submit"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Agents
        </h2>
        <div className="mt-3 grid gap-2">
          {agents.map((a) => (
            <div
              key={a.name}
              className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">{a.displayName}</div>
                <div className="text-xs text-muted-foreground">
                  {a.description}
                </div>
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {a.schedule}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Reports
        </h2>
        <p className="mt-3 text-sm">
          <Link
            href="/reports"
            className="text-accent hover:underline"
          >
            View all reports →
          </Link>
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Tools
        </h2>
        <ul className="mt-3 space-y-1 text-sm">
          <li>
            <Link
              href="/dashboard/ops"
              className="text-accent hover:underline"
            >
              Ops — click-through setup, data refresh and agent runs
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard/diagnostics"
              className="text-accent hover:underline"
            >
              Diagnostics — adapter readiness, row counts, manual ingest
            </Link>
          </li>
        </ul>
      </section>

      <footer className="mt-16 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          ← back to landing
        </Link>
      </footer>
    </main>
  );
}

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
