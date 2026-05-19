import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">marketintel</h1>
      <p className="mt-2 text-muted-foreground">
        Five investment research agents. Reports are generated on a schedule and
        persisted with the evidence they were scored on.
      </p>

      <section className="mt-10 grid gap-3">
        <AgentRow name="IPO Evaluation" cadence="Weekly · Sun 18:00" status="not built" />
        <AgentRow name="Dividend Intelligence" cadence="Weekly · Fri 18:00" status="not built" />
        <AgentRow name="Geopolitical Scanner" cadence="Weekly · Sun 20:00" status="not built" />
        <AgentRow name="Energy Beneficiaries" cadence="Weekly · Sat 10:00" status="not built" />
        <AgentRow name="Precious Metals" cadence="Weekly · Sat 12:00" status="not built" />
      </section>

      <section className="mt-10">
        <Link
          href="/login"
          className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Sign in
        </Link>
      </section>
    </main>
  );
}

function AgentRow({
  name,
  cadence,
  status,
}: {
  name: string;
  cadence: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3">
      <div>
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{cadence}</div>
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {status}
      </div>
    </div>
  );
}
