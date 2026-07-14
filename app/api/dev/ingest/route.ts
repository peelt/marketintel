import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { seedUniverse } from "@/lib/ingest/seed-universe";
import { ingestPriceSnapshots } from "@/lib/ingest/ingest-prices";
import { ingestDividends } from "@/lib/ingest/ingest-dividends";
import { ingestFinancials } from "@/lib/ingest/ingest-financials";
import { ingestMacro } from "@/lib/ingest/ingest-macro";
import { ingestNews } from "@/lib/ingest/ingest-news";
import { allSeedSecurities } from "@/lib/data-sources/universes";
import { getPriceSource, type FallbackEvent } from "@/lib/data-sources/price-source";
import * as fred from "@/lib/data-sources/fred";
import * as newsRss from "@/lib/data-sources/news-rss";
import { collectPerTicker } from "@/lib/ingest/failure-report";
import { getErrorMessage } from "@/lib/errors";

/** Inclusive YYYY-MM-DD bounds for a trailing window ending today. */
function lookback(days: number): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

/**
 * Dev-only manual ingest endpoint.
 *
 * POST /api/dev/ingest?task=<task>
 *
 *   task=seed-universe   — seed/refresh the curated tickers in `securities`
 *   task=prices          — pull 1y daily prices for the entire seed universe
 *   task=dividends       — pull 5y dividend history
 *   task=fundamentals    — pull TTM fundamentals snapshot
 *   task=macro           — pull all FRED series in lib/data-sources/fred.ts
 *   task=news            — pull all RSS feeds
 *   task=status          — return adapter readiness, no side effects
 *
 * POST (not GET) because every task except `status` mutates state and fans
 * out to external APIs — a cookie-authenticated GET was CSRF-able via a
 * simple <img> tag. In production the route additionally requires the
 * x-dev-ingest-secret header to match DEV_INGEST_SECRET (unset = disabled in
 * production). Scheduled ingest belongs to Inngest jobs, not this route.
 */

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.DEV_INGEST_SECRET;
    if (!secret || request.headers.get("x-dev-ingest-secret") !== secret) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAllowedEmail(user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const task = request.nextUrl.searchParams.get("task");
  try {
    switch (task) {
      case "seed-universe": {
        const result = await seedUniverse();
        return NextResponse.json(result);
      }
      case "prices": {
        const fallbacks: FallbackEvent[] = [];
        const source = await getPriceSource((e) => fallbacks.push(e));
        const { from, to } = lookback(365);
        const { rows, report } = await collectPerTicker(
          "prices",
          allSeedSecurities(),
          (s) => source.fetchPrices({ ticker: s.ticker, exchange: s.exchange, from, to }),
        );
        report.fallbacks = fallbacks;
        const ingest = await ingestPriceSnapshots(rows);
        return NextResponse.json({ pulled: rows.length, ...ingest, report });
      }
      case "dividends": {
        const fallbacks: FallbackEvent[] = [];
        const source = await getPriceSource((e) => fallbacks.push(e));
        const { from, to } = lookback(5 * 365);
        const { rows, report } = await collectPerTicker(
          "dividends",
          allSeedSecurities(),
          (s) => source.fetchDividends({ ticker: s.ticker, exchange: s.exchange, from, to }),
        );
        report.fallbacks = fallbacks;
        const ingest = await ingestDividends(rows);
        return NextResponse.json({ pulled: rows.length, ...ingest, report });
      }
      case "fundamentals": {
        const fallbacks: FallbackEvent[] = [];
        const source = await getPriceSource((e) => fallbacks.push(e));
        const { rows, report } = await collectPerTicker(
          "fundamentals",
          allSeedSecurities(),
          async (s) => {
            const snap = await source.fetchFundamentals({
              ticker: s.ticker,
              exchange: s.exchange,
            });
            return snap ? [snap] : [];
          },
        );
        report.fallbacks = fallbacks;
        const ingest = await ingestFinancials(rows);
        return NextResponse.json({ pulled: rows.length, ...ingest, report });
      }
      case "macro": {
        const { from, to } = lookback(365);
        const series = Object.entries(fred.SERIES).map(([label, seriesId]) => ({
          ticker: seriesId,
          exchange: "FRED",
          label,
          seriesId,
        }));
        const { rows, report } = await collectPerTicker("macro", series, (s) =>
          fred.fetchSeries({
            seriesId: s.seriesId,
            observationStart: from,
            observationEnd: to,
          }),
        );
        const ingest = await ingestMacro(rows);
        return NextResponse.json({ pulled: rows.length, ...ingest, report });
      }
      case "news": {
        const all = await newsRss.fetchAllFeeds();
        const ingest = await ingestNews(all);
        return NextResponse.json({ pulled: all.length, ...ingest });
      }
      case "status":
      case null:
      case undefined: {
        const { listReadyAdapters, listStubbedAdapters, finnhub } = await import(
          "@/lib/data-sources"
        );
        // LSE coverage probe (plan §5): Finnhub is provisional as primary
        // until this reports covered=true on the live key.
        const lseCoverage =
          finnhub.capabilities.readinessCheck() === null
            ? await finnhub.probeLseCoverage().catch((err: unknown) => ({
                covered: false as const,
                reason: getErrorMessage(err),
              }))
            : { covered: false as const, reason: "finnhub not configured" };
        return NextResponse.json({
          ready: listReadyAdapters().map((a) => a.name),
          stubbed: listStubbedAdapters().map((x) => ({
            name: x.adapter.name,
            reason: x.reason,
          })),
          finnhubLseCoverage: lseCoverage,
        });
      }
      default:
        return NextResponse.json(
          { error: `unknown task: ${task}` },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err) },
      { status: 500 },
    );
  }
}
