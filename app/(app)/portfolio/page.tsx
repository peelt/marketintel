import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { ClassificationChip } from "@/components/cli";
import { Disclaimer } from "@/components/disclaimer";
import { loadDefaultPortfolio, loadHeldNames } from "@/lib/holdings/data";
import { loadPortfolioIntel } from "@/lib/holdings/intel";
import {
  PortfolioHealthBar,
  WhatChangedFeed,
} from "@/components/portfolio-intel";
import { fetchRates } from "@/lib/holdings/fx";
import {
  portfolioTotals,
  requiredRatePairs,
  valueHolding,
} from "@/lib/holdings/valuation";
import {
  changeColor,
  dayChangeFraction,
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
} from "@/lib/format";
import { AddHolding, DeleteHoldingButton } from "./portfolio-controls";

export const dynamic = "force-dynamic";

/**
 * My Portfolio (PR 6a). Factual performance only — value, day change,
 * unrealised P/L vs cost basis — plus each held name's latest desk verdict as
 * the seam where the intel lens (6b) plugs in. Purchase price drives P/L
 * display, never scoring (I2).
 */
export default async function PortfolioPage() {
  const supabase = await createClient();
  const { userId } = await getSessionContext();
  if (!userId) redirect("/login");
  const portfolio = await loadDefaultPortfolio(supabase, userId);
  const [held, intel] = portfolio
    ? await Promise.all([
        loadHeldNames(supabase, portfolio.id),
        loadPortfolioIntel(supabase, portfolio.id),
      ])
    : [[], { items: [], attentionCount: 0, health: { covered: 0, flagged: 0, byClassification: [] } }];
  const base = portfolio?.base_currency ?? "GBP";

  // FX: fetch only the pairs actually needed, then value every holding.
  const rates =
    held.length > 0
      ? await fetchRates(requiredRatePairs(held, base))
      : new Map<string, number>();

  const valued = held.map((h) => ({
    held: h,
    v: valueHolding(
      {
        quantity: h.quantity,
        latestClose: h.latestClose,
        priceCurrency: h.priceCurrency,
        previousClose: h.previousClose,
        purchasePrice: h.purchasePrice,
        purchaseCurrency: h.purchaseCurrency,
      },
      base,
      rates,
    ),
  }));
  const totals = portfolioTotals(valued.map((x) => x.v));
  const hasCostBasis = held.some((h) => h.purchasePrice != null);

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-mono-cli text-base text-il-navy">~ my portfolio</div>
            <h1 className="mt-1 text-3xl font-bold text-il-navy">Portfolio</h1>
          </div>
          <Link
            href="/dashboard"
            className="font-mono-cli text-sm text-muted-foreground hover:text-il-orange"
          >
            ← dashboard
          </Link>
        </div>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">
          The names you hold, valued daily, with every desk&apos;s verdicts
          filtered to them. Purchase price is optional — it powers your P/L
          display and never influences any score.
        </p>

        {/* Totals band */}
        {held.length > 0 && (
          <section className="card-cli mt-6 flex flex-wrap items-baseline gap-x-10 gap-y-3 p-6">
            <div>
              <div className="font-mono-cli text-sm text-muted-foreground">
                total value
              </div>
              <div className="mt-1 text-2xl font-bold text-il-navy">
                {formatMoney(totals.baseValue, base)}
              </div>
            </div>
            <div>
              <div className="font-mono-cli text-sm text-muted-foreground">
                day change
              </div>
              <div
                className="mt-1 text-2xl font-bold"
                style={{ color: changeColor(totals.baseDayChange) }}
              >
                {formatSignedMoney(totals.baseDayChange, base)}
                {dayChangeFraction(totals.baseValue, totals.baseDayChange) !== null && (
                  <span className="ml-1.5 text-lg font-normal">
                    ({formatSignedPercent(dayChangeFraction(totals.baseValue, totals.baseDayChange))})
                  </span>
                )}
              </div>
            </div>
            {hasCostBasis && (
              <div>
                <div className="font-mono-cli text-sm text-muted-foreground">
                  unrealised P/L
                </div>
                <div
                  className="mt-1 text-2xl font-bold"
                  style={{ color: changeColor(totals.baseUnrealisedPnl) }}
                >
                  {formatSignedMoney(totals.baseUnrealisedPnl, base)}
                </div>
              </div>
            )}
            <div className="ml-auto max-w-xs font-mono-cli text-sm text-muted-foreground">
              value in {base}. Performance is factual arithmetic — not advice,
              and not tax accounting.
              {totals.fxMissingCount > 0 && (
                <>
                  {" "}
                  {totals.fxMissingCount} holding
                  {totals.fxMissingCount === 1 ? "" : "s"} shown in native
                  currency (no FX rate).
                </>
              )}
            </div>
          </section>
        )}

        {/* Add flow stays prominent while the book is small */}
        {held.length > 0 && held.length < 3 && (
          <div className="mt-6">
            <AddHolding />
          </div>
        )}

        {/* Intel lens — what changed on your names + portfolio health */}
        {held.length > 0 && (
          <>
            <section className="mt-8">
              <div className="flex items-baseline justify-between">
                <div className="font-mono-cli text-base text-il-navy">
                  ~ what changed on your names
                </div>
                {intel.attentionCount > 0 && (
                  <span
                    className="font-mono-cli text-sm font-bold"
                    style={{ color: "#ee1d23" }}
                  >
                    {intel.attentionCount} need
                    {intel.attentionCount === 1 ? "s" : ""} a look
                  </span>
                )}
              </div>
              <div className="mt-3">
                <WhatChangedFeed items={intel.items} />
              </div>
            </section>

            <section className="card-cli mt-6 p-6">
              <div className="font-mono-cli text-base text-il-navy">
                ~ portfolio health
              </div>
              <div className="mt-3">
                <PortfolioHealthBar health={intel.health} />
              </div>
              <p className="mt-3 font-mono-cli text-sm text-muted-foreground">
                The desk&apos;s classifications across the names you hold. This
                filters the whole service to your portfolio — it never changes
                how any security is scored.
              </p>
            </section>
          </>
        )}

        {/* Holdings table */}
        {held.length > 0 && (
          <section className="mt-8">
            <div className="font-mono-cli text-base text-il-navy">~ holdings</div>
            <div className="card-cli mt-3 overflow-x-auto p-0">
              <table className="w-full text-base">
                <thead className="bg-il-tint font-mono-cli text-sm text-il-navy">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Name</th>
                    <th className="px-4 py-2.5 text-right">Qty</th>
                    <th className="px-4 py-2.5 text-right">Value</th>
                    <th className="px-4 py-2.5 text-right">Day</th>
                    {hasCostBasis && (
                      <th className="px-4 py-2.5 text-right">P/L</th>
                    )}
                    <th className="px-4 py-2.5 text-left">Latest verdict</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {valued.map(({ held: h, v }) => (
                    <tr key={h.holdingId} className="border-t border-border align-top">
                      <td className="px-4 py-3">
                        <Link
                          href={`/names/${h.securityId}`}
                          className="group"
                          title="See every desk's read on this name"
                        >
                          <span className="font-mono-cli font-bold text-il-navy group-hover:text-il-orange">
                            {h.ticker}
                          </span>
                          <span className="ml-2 text-muted-foreground group-hover:text-il-navy">
                            {h.name}
                          </span>
                        </Link>
                        <span className="ml-2 font-mono-cli text-sm text-muted-foreground">
                          {h.exchange}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono-cli">
                        {h.quantity}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-cli">
                        {v.baseValue != null
                          ? formatMoney(v.baseValue, base)
                          : v.nativeValue != null
                            ? formatMoney(v.nativeValue, v.nativeCurrency ?? base)
                            : "no data"}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-mono-cli"
                        style={{ color: changeColor(v.baseDayChange) }}
                      >
                        {formatSignedMoney(v.baseDayChange, base)}
                      </td>
                      {hasCostBasis && (
                        <td
                          className="px-4 py-3 text-right font-mono-cli"
                          style={{ color: changeColor(v.baseUnrealisedPnl) }}
                        >
                          {v.baseUnrealisedPnl != null || v.simpleReturn != null ? (
                            <>
                              {formatSignedMoney(v.baseUnrealisedPnl, base)}
                              {v.simpleReturn != null && (
                                <span className="ml-1 text-sm">
                                  ({formatSignedPercent(v.simpleReturn)})
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        {h.classification ? (
                          <Link
                            href={h.verdictReportId ? `/reports/${h.verdictReportId}` : "/reports"}
                            title={
                              h.classification === "insufficient_data"
                                ? "The desk saw this name but withheld a classification — not enough data behind the framework this run. Open the report to see exactly what was missing."
                                : "The desk's latest classification — open the report for the evidence behind it."
                            }
                          >
                            <ClassificationChip classification={h.classification} />
                          </Link>
                        ) : (
                          <span
                            className="font-mono-cli text-sm text-muted-foreground"
                            title="The desk has not screened this name yet. Coverage builds automatically as it runs on schedule."
                          >
                            not yet covered
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeleteHoldingButton holdingId={h.holdingId} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              “Latest verdict” is the most recent desk classification for each
              name — the intel lens that filters every report to what you hold.
              A cut-risk flag or overshoot on a name you own will surface here.
            </p>
          </section>
        )}

        {held.length === 0 && (
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Add the shares you hold to see their live value and — the point —
            the desk&apos;s verdicts filtered to your names. Purchase price is
            optional and never affects any score; it only powers your P/L.
          </p>
        )}

        {(held.length === 0 || held.length >= 3) && (
          <div className="mt-8">
            <AddHolding />
          </div>
        )}

        <Disclaimer />
      </main>
    </>
  );
}
