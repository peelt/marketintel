import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import {
  ClassificationChip,
  CoverageBar,
} from "@/components/cli";
import { Disclaimer } from "@/components/disclaimer";
import { PriceChart, type PricePoint } from "@/components/price-chart";
import {
  compositeDisplay,
  humanizeDateTime,
  securityDisplayLabel,
} from "@/lib/format";
import { describeDelta } from "@/lib/holdings/deltas";
import { MODULE_COLORS } from "@/components/cli";
import { loadSecurityDossier } from "@/lib/security/dossier";

export const dynamic = "force-dynamic";

/**
 * The per-security page: the desk's latest read on ONE name, plus price,
 * with a link out to each report for the cited evidence. A company-first view
 * over an edition-first data model.
 */
export default async function SecurityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { userId } = await getSessionContext();
  if (!userId) redirect("/login");
  const dossier = await loadSecurityDossier(supabase, id, MODULE_COLORS);
  if (!dossier) notFound();

  const { security, desks, prices } = dossier;
  const points: PricePoint[] = prices.map((p) => ({ date: p.date, close: p.close }));
  const currency = prices.find((p) => p.currency)?.currency ?? security.currency;
  const label = securityDisplayLabel(security);
  const secondary =
    label === security.ticker ? security.name : security.ticker;

  return (
    <>
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Link
          href="/reports"
          className="font-mono-cli text-sm text-muted-foreground hover:text-il-orange"
        >
          ← reports
        </Link>

        {/* Identity */}
        <header className="mt-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-3xl font-bold text-il-navy">{label}</h1>
            {secondary && (
              <span className="text-lg text-muted-foreground">{secondary}</span>
            )}
          </div>
          <div className="mt-1 font-mono-cli text-sm text-muted-foreground">
            {security.exchange}
            {security.sector ? ` · ${security.sector}` : ""}
            {security.subSector ? ` · ${security.subSector}` : ""}
            {security.delistedAt ? " · delisted" : ""}
          </div>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground">
            The desk&apos;s current read on this name, and what changed since
            its last edition. Open a report for the evidence behind any
            verdict.
          </p>
        </header>

        {/* Price */}
        {points.length >= 2 && (
          <section className="card-cli mt-6 p-6">
            <div className="mb-2 font-mono-cli text-sm text-il-navy">
              ~ price · trailing year
            </div>
            <PriceChart points={points} currency={currency} />
          </section>
        )}

        {/* Desk verdicts — the point of the page */}
        <section className="mt-8">
          <div className="font-mono-cli text-base text-il-navy">
            ~ what the desk says
          </div>
          {desks.length === 0 ? (
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              No desk has filed a verdict on this name in the last six months. It
              stays in the universe and will be picked up automatically when a
              relevant desk next runs.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {desks.map((d) => (
                <div
                  key={d.agentName}
                  className="card-cli card-cli-module p-5"
                  style={
                    { "--module-color": d.moduleColor } as React.CSSProperties
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-base font-bold text-il-navy">
                        {d.agentDisplay}
                      </span>
                      {d.classification && (
                        <ClassificationChip classification={d.classification} />
                      )}
                      {d.delta.attention && (
                        <span
                          className="font-mono-cli text-sm font-bold"
                          style={{ color: "#ee1d23" }}
                        >
                          changed
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono-cli text-sm text-muted-foreground">
                      <span>{compositeDisplay(d.composite, d.coverage ?? undefined)}</span>
                      {d.coverage != null && d.coverage < 0.999 && (
                        <CoverageBar coverage={d.coverage} />
                      )}
                    </div>
                  </div>

                  {d.verdict && (
                    <p className="mt-3 text-base leading-relaxed text-foreground">
                      {d.verdict}
                    </p>
                  )}

                  {/* What changed since this desk's previous edition. */}
                  {d.delta.direction !== "steady" && d.delta.previous && (
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {describeDelta(d.delta, label, d.agentDisplay)}
                    </p>
                  )}

                  <div className="mt-3 flex items-baseline justify-between font-mono-cli text-sm text-muted-foreground">
                    <span>filed {humanizeDateTime(d.generatedAt)}</span>
                    {d.reportId && (
                      <Link
                        href={`/reports/${d.reportId}`}
                        className="text-il-accent hover:text-il-orange"
                      >
                        report & evidence →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <Disclaimer />
      </main>
    </>
  );
}
