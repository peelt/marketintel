import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { listReadyAdapters, listStubbedAdapters } from "@/lib/data-sources";
import { allSeedSecurities } from "@/lib/data-sources/universes";
import { loadReactionCoverageSplit } from "@/lib/reports/reaction-coverage";

export const dynamic = "force-dynamic";

export default async function DiagnosticsPage() {
  const supabase = await createClient();
  const { userId, isOwner } = await getSessionContext();
  if (!userId || !isOwner) redirect("/login");

  const ready = listReadyAdapters();
  const stubbed = listStubbedAdapters();
  const seedCount = allSeedSecurities().length;

  // Counts via the RLS-scoped client — the entitled-read policies cover these
  // tables, and the service-role client must never run on a request-reachable
  // path (see lib/supabase/service.ts).
  const reactionSplitPromise = loadReactionCoverageSplit(supabase);
  const counts = await Promise.all(
    [
      "securities",
      "price_snapshots",
      "dividends",
      "financials_snapshot",
      "macro_indicators",
      "news_articles",
      "filings",
    ].map(async (table) => {
      const { count } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      return { table, count: count ?? 0 };
    }),
  );
  const reactionSplit = await reactionSplitPromise;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Data health</h1>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← dashboard
        </Link>
      </header>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Engine diagnostics: which data sources are configured, what&apos;s
        serving prices, and row counts per table.
      </p>

      <Section title="Adapter readiness">
        <ul className="mt-3 space-y-1 text-sm">
          {ready.map((a) => (
            <li key={a.name} className="flex justify-between font-mono">
              <span>{a.name}</span>
              <span className="text-green-600 dark:text-green-400">ready</span>
            </li>
          ))}
          {stubbed.map((s) => (
            <li key={s.adapter.name} className="flex justify-between font-mono">
              <span>{s.adapter.name}</span>
              <span className="text-muted-foreground">{s.reason}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Seed universe">
        <p className="mt-3 text-sm text-muted-foreground">
          {seedCount} curated securities across metals, energy and dividend buckets.
        </p>
      </Section>

      <Section title="Row counts">
        <ul className="mt-3 space-y-1 text-sm font-mono">
          {counts.map((c) => (
            <li key={c.table} className="flex justify-between">
              <span>{c.table}</span>
              <span>{c.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Reaction evidence split — UK vs US">
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Feeds the London-fundamentals decision: whether LSE names actually
          file with thinner evidence than US names (the predicted ≈18% gap from
          the blocked LSE fundamentals source), measured over the last{" "}
          {reactionSplit.editions || "—"} reaction edition
          {reactionSplit.editions === 1 ? "" : "s"}
          {reactionSplit.from
            ? ` (${reactionSplit.from.slice(0, 10)} → ${reactionSplit.to?.slice(0, 10)})`
            : ""}
          .
        </p>
        {reactionSplit.editions === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No succeeded reaction editions yet.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-1 font-medium">market</th>
                <th className="py-1 text-right font-medium">names scored</th>
                <th className="py-1 text-right font-medium">avg coverage</th>
                <th className="py-1 text-right font-medium">with news grade</th>
                <th className="py-1 text-right font-medium">with fundamentals</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {reactionSplit.markets.map((m) => (
                <tr key={m.market}>
                  <td className="py-1">{m.market}</td>
                  <td className="py-1 text-right">{m.n}</td>
                  <td className="py-1 text-right">
                    {m.avgCoverage === null
                      ? "—"
                      : `${Math.round(m.avgCoverage * 100)}%`}
                  </td>
                  <td className="py-1 text-right">
                    {m.n === 0 ? "—" : `${m.withNews}/${m.n}`}
                  </td>
                  <td className="py-1 text-right">
                    {m.n === 0 ? "—" : `${m.withFundamentals}/${m.n}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Manual ingest">
        <p className="mt-3 text-sm text-muted-foreground">
          POST these endpoints (auth-required; in production also requires the
          x-dev-ingest-secret header) to manually trigger ingest tasks:
        </p>
        <ul className="mt-2 space-y-1 font-mono text-xs">
          <li>POST /api/dev/ingest?task=seed-universe</li>
          <li>POST /api/dev/ingest?task=prices</li>
          <li>POST /api/dev/ingest?task=dividends</li>
          <li>POST /api/dev/ingest?task=fundamentals</li>
          <li>POST /api/dev/ingest?task=macro</li>
          <li>POST /api/dev/ingest?task=news</li>
        </ul>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
