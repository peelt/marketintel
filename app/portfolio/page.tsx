import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { SiteHeader, ClassificationChip } from "@/components/cli";
import { Disclaimer } from "@/components/disclaimer";
import { loadDefaultPortfolio, loadHeldNames } from "@/lib/holdings/data";
import { fetchRates } from "@/lib/holdings/fx";
import {
  portfolioTotals,
  requiredRatePairs,
  valueHolding,
} from "@/lib/holdings/valuation";
import {
  changeColor,
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) redirect("/login");

  const portfolio = await loadDefaultPortfolio(supabase, user.id);
  const held = portfolio ? await loadHeldNames(supabase, portfolio.id) : [];
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
      <SiteHeader active="portfolio" />
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
                        <span className="font-mono-cli font-bold text-il-navy">
                          {h.ticker}
                        </span>
                        <span className="ml-2 text-muted-foreground">{h.name}</span>
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
                          <Link href={h.verdictReportId ? `/reports/${h.verdictReportId}` : "/reports"}>
                            <ClassificationChip classification={h.classification} />
                          </Link>
                        ) : (
                          <span className="font-mono-cli text-sm text-muted-foreground">
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

        <div className="mt-8">
          <AddHolding />
        </div>

        <Disclaimer />
      </main>
    </>
  );
}
