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
import * as yfinance from "@/lib/data-sources/yfinance";
import * as fred from "@/lib/data-sources/fred";
import * as newsRss from "@/lib/data-sources/news-rss";
import { getErrorMessage } from "@/lib/errors";

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
        const seeds = allSeedSecurities();
        const all = [];
        for (const s of seeds) {
          try {
            const batch = await yfinance.fetchPriceHistory({
              ticker: s.ticker,
              exchange: s.exchange,
              range: "1y",
              interval: "1d",
            });
            all.push(...batch);
          } catch {
            // Skip and continue — yfinance is unofficial, individual failures are expected.
          }
        }
        const ingest = await ingestPriceSnapshots(all);
        return NextResponse.json({ pulled: all.length, ...ingest });
      }
      case "dividends": {
        const seeds = allSeedSecurities();
        const all = [];
        for (const s of seeds) {
          try {
            const batch = await yfinance.fetchDividendHistory({
              ticker: s.ticker,
              exchange: s.exchange,
              range: "5y",
            });
            all.push(...batch);
          } catch {
            /* skip */
          }
        }
        const ingest = await ingestDividends(all);
        return NextResponse.json({ pulled: all.length, ...ingest });
      }
      case "fundamentals": {
        const seeds = allSeedSecurities();
        const all = [];
        for (const s of seeds) {
          try {
            const snap = await yfinance.fetchFundamentalsSnapshot({
              ticker: s.ticker,
              exchange: s.exchange,
            });
            if (snap) all.push(snap);
          } catch {
            /* skip */
          }
        }
        const ingest = await ingestFinancials(all);
        return NextResponse.json({ pulled: all.length, ...ingest });
      }
      case "macro": {
        const all = [];
        const today = new Date().toISOString().slice(0, 10);
        const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        for (const [_label, seriesId] of Object.entries(fred.SERIES)) {
          try {
            const obs = await fred.fetchSeries({
              seriesId,
              observationStart: start,
              observationEnd: today,
            });
            all.push(...obs);
          } catch {
            /* skip */
          }
        }
        const ingest = await ingestMacro(all);
        return NextResponse.json({ pulled: all.length, ...ingest });
      }
      case "news": {
        const all = await newsRss.fetchAllFeeds();
        const ingest = await ingestNews(all);
        return NextResponse.json({ pulled: all.length, ...ingest });
      }
      case "status":
      case null:
      case undefined: {
        const { listReadyAdapters, listStubbedAdapters } = await import(
          "@/lib/data-sources"
        );
        return NextResponse.json({
          ready: listReadyAdapters().map((a) => a.name),
          stubbed: listStubbedAdapters().map((x) => ({
            name: x.adapter.name,
            reason: x.reason,
          })),
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
