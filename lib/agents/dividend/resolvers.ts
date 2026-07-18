import type { EvidenceItem } from "@/lib/agents/types";
import type {
  SignalResolverRegistry,
  SignalValue,
} from "@/lib/scoring/types";
import type { DividendDataset } from "./data";
import { loadDividendDataset } from "./data";
import { isStale } from "@/lib/data-sources/staleness";
import {
  annualDividendSeries,
  debtToEbitda,
  dividendGrowthCagr,
  fcfCover,
  median,
  payoutRatio,
  trailingYield,
  ttmDividendPerShare,
  yearsWithoutCut,
  yoyChange,
  zScore,
} from "./metrics";

/**
 * Dividend signal resolvers. Batch-only in practice: the dataset is loaded
 * once per run (memoised promise) and every signal is computed from it in
 * memory. Each SignalValue carries the evidence rows that justify it —
 * evidence-first is the point of the product, not an afterthought.
 *
 * Evidence weights are the resolver's own 0–1 confidence in the value —
 * NEVER multiplied by framework weights (scoring-engine semantics, CLAUDE.md).
 */

interface CandidateMetrics {
  yield_ttm: number | null;
  ttmDps: number | null;
  latestPrice: number | null;
  priceCurrency: string | null;
  paymentsInTtm: number;
  payout_ratio_ttm: number | null;
  fcf_cover_ttm: number | null;
  debt_to_ebitda_ttm: number | null;
  growth_5y_cagr: number | null;
  years_without_cut: number | null;
  yield_zscore_24m: number | null;
  yieldHistoryPoints: number;
  ocf_yoy_change: number | null;
  latestFinancialsId: string | null;
  latestFinancialsSummary: string | null;
  latestDividendId: string | null;
  sector: string | null;
  ticker: string;
}

function computeCandidate(
  dataset: DividendDataset,
  securityId: string,
): CandidateMetrics | null {
  const security = dataset.securities.get(securityId);
  if (!security) return null;

  const divRows = dataset.dividends.get(securityId) ?? [];
  const priceRows = dataset.prices.get(securityId) ?? [];
  const finRows = dataset.financials.get(securityId) ?? [];

  const payments = divRows.map((d) => ({ exDate: d.ex_date, amount: d.amount }));
  const latest = priceRows.length ? priceRows[priceRows.length - 1] : null;

  // Staleness backstop (parity with the metals desk): trailing yield is
  // DPS / price, so a weeks-old close (a failed price refresh) would misstate
  // it and the sector-relative yield built on it. Treat a stale close as no
  // price — yield_ttm goes null, its signals redistribute, coverage drops
  // honestly. Currency doesn't go stale, so it's still read for display.
  const latestFresh =
    latest && !isStale(latest.snapshot_date, dataset.asOf) ? latest : null;

  const ttmDps = ttmDividendPerShare(payments, dataset.asOf);
  const yieldTtm = trailingYield(ttmDps, latestFresh?.close ?? null);

  const series = annualDividendSeries(payments, dataset.asOf);

  // Month-end yield history for the 24m z-score: last close of each calendar
  // month, each paired with the TTM dividends as of that date.
  const monthEnds = new Map<string, { date: string; close: number }>();
  for (const p of priceRows) {
    monthEnds.set(p.snapshot_date.slice(0, 7), {
      date: p.snapshot_date,
      close: p.close,
    });
  }
  const yieldHistory: number[] = [];
  for (const { date, close } of [...monthEnds.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    const dps = ttmDividendPerShare(payments, date);
    const y = trailingYield(dps, close);
    if (y !== null) yieldHistory.push(y);
  }

  const latestFin = finRows[0] ?? null;
  // A prior-year comparable for OCF: the oldest of the (max 3) newest rows,
  // provided it's ~a year older than the latest.
  const priorFin =
    finRows.find(
      (f) =>
        latestFin &&
        f.id !== latestFin.id &&
        monthsBetween(f.period_end, latestFin.period_end) >= 9,
    ) ?? null;

  const paymentsInTtm = payments.filter((p) => {
    const t = Date.parse(p.exDate);
    const end = Date.parse(dataset.asOf);
    return t > end - 365 * 24 * 60 * 60 * 1000 && t <= end;
  }).length;

  return {
    yield_ttm: yieldTtm,
    ttmDps,
    latestPrice: latestFresh?.close ?? null,
    priceCurrency: latest?.currency ?? null,
    paymentsInTtm,
    payout_ratio_ttm: payoutRatio(latestFin?.dividends_paid, latestFin?.net_income),
    fcf_cover_ttm: fcfCover(latestFin?.free_cash_flow, latestFin?.dividends_paid),
    debt_to_ebitda_ttm: debtToEbitda(latestFin?.total_debt, latestFin?.ebitda),
    growth_5y_cagr: dividendGrowthCagr(series, 5),
    years_without_cut: yearsWithoutCut(series),
    yield_zscore_24m: zScore(yieldHistory),
    yieldHistoryPoints: yieldHistory.length,
    ocf_yoy_change: yoyChange(
      latestFin?.operating_cash_flow,
      priorFin?.operating_cash_flow,
    ),
    latestFinancialsId: latestFin?.id ?? null,
    latestFinancialsSummary: latestFin
      ? `${security.ticker} financials (${latestFin.period_type}, period end ${latestFin.period_end}, source ${latestFin.source})`
      : null,
    latestDividendId: divRows.length ? divRows[divRows.length - 1].id : null,
    sector: security.sector,
    ticker: security.ticker,
  };
}

function monthsBetween(earlier: string, later: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / (30 * 24 * 60 * 60 * 1000);
}

function financialsEvidence(
  m: CandidateMetrics,
  text: string,
  weight: number,
): EvidenceItem[] {
  if (!m.latestFinancialsId) return [];
  return [
    {
      type: "financial_snapshot",
      sourceTable: "financials_snapshot",
      sourceId: m.latestFinancialsId,
      text: `${text} — from ${m.latestFinancialsSummary}`,
      weight,
    },
  ];
}

function dividendEvidence(
  m: CandidateMetrics,
  text: string,
  weight: number,
): EvidenceItem[] {
  if (!m.latestDividendId) return [];
  return [
    {
      type: "dividend_record",
      sourceTable: "dividends",
      sourceId: m.latestDividendId,
      text,
      weight,
    },
  ];
}

function derivedEvidence(text: string, weight: number): EvidenceItem[] {
  return [
    {
      type: "derived_metric",
      sourceTable: "derived",
      sourceId: "",
      text,
      weight,
    },
  ];
}

const NO_DATA: SignalValue = { raw: null, evidence: [] };

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

/**
 * Create the dividend resolver registry. The dataset loads lazily on first
 * resolution and is shared by every signal in the run.
 */
export function createDividendResolver(): SignalResolverRegistry {
  let datasetPromise: Promise<DividendDataset> | null = null;
  const metricsCache = new Map<string, CandidateMetrics | null>();

  async function metricsFor(
    securityIds: string[],
  ): Promise<Map<string, CandidateMetrics>> {
    datasetPromise ??= loadDividendDataset(securityIds);
    const dataset = await datasetPromise;
    const out = new Map<string, CandidateMetrics>();
    for (const id of securityIds) {
      if (!metricsCache.has(id)) {
        metricsCache.set(id, computeCandidate(dataset, id));
      }
      const m = metricsCache.get(id);
      if (m) out.set(id, m);
    }
    return out;
  }

  async function resolveBatch(params: {
    securityIds: string[];
    sourceQuery: string;
  }): Promise<Map<string, SignalValue>> {
    const metrics = await metricsFor(params.securityIds);
    const out = new Map<string, SignalValue>();

    // Sector-relative yield needs cross-candidate context: median yield per
    // sector across THIS candidate set, whole-set median as fallback.
    const sectorYields = new Map<string, number[]>();
    const allYields: number[] = [];
    for (const m of metrics.values()) {
      if (m.yield_ttm === null) continue;
      allYields.push(m.yield_ttm);
      if (m.sector) {
        const arr = sectorYields.get(m.sector) ?? [];
        arr.push(m.yield_ttm);
        sectorYields.set(m.sector, arr);
      }
    }

    for (const id of params.securityIds) {
      const m = metrics.get(id);
      if (!m) {
        out.set(id, NO_DATA);
        continue;
      }
      out.set(id, resolveSignal(params.sourceQuery, m, { sectorYields, allYields }));
    }
    return out;
  }

  return {
    resolve: async ({ securityId, sourceQuery }) => {
      const batch = await resolveBatch({ securityIds: [securityId], sourceQuery });
      return batch.get(securityId) ?? NO_DATA;
    },
    resolveBatch,
  };
}

function resolveSignal(
  sourceQuery: string,
  m: CandidateMetrics,
  ctx: { sectorYields: Map<string, number[]>; allYields: number[] },
): SignalValue {
  switch (sourceQuery) {
    case "dividend.yield_ttm_vs_sector": {
      if (m.yield_ttm === null) return NO_DATA;
      const peers =
        (m.sector ? ctx.sectorYields.get(m.sector) : null) ?? ctx.allYields;
      const peerMedian = median(peers);
      if (peerMedian === null || peerMedian <= 0) return NO_DATA;
      const raw = m.yield_ttm / peerMedian;
      const scopeNote =
        m.sector && (ctx.sectorYields.get(m.sector)?.length ?? 0) >= 3
          ? `sector '${m.sector}' median (${pct(peerMedian)})`
          : `screen-wide median (${pct(peerMedian)})`;
      return {
        raw,
        evidence: [
          ...dividendEvidence(
            m,
            `${m.ticker}: TTM dividends/share ${m.ttmDps?.toFixed(4)} over ${m.paymentsInTtm} payment(s); price ${m.latestPrice}${m.priceCurrency ? ` ${m.priceCurrency}` : ""} → trailing yield ${pct(m.yield_ttm)}`,
            0.85,
          ),
          ...derivedEvidence(
            `${m.ticker}: trailing yield ${pct(m.yield_ttm)} = ${raw.toFixed(2)}× the ${scopeNote}`,
            0.7,
          ),
        ],
      };
    }
    case "dividend.payout_ratio_ttm": {
      if (m.payout_ratio_ttm === null) return NO_DATA;
      return {
        raw: m.payout_ratio_ttm,
        evidence: financialsEvidence(
          m,
          `${m.ticker}: payout ratio ${pct(m.payout_ratio_ttm)} of net income`,
          0.85,
        ),
      };
    }
    case "dividend.fcf_cover_ttm": {
      if (m.fcf_cover_ttm === null) return NO_DATA;
      return {
        raw: m.fcf_cover_ttm,
        evidence: financialsEvidence(
          m,
          `${m.ticker}: free cash flow covers the dividend ${m.fcf_cover_ttm.toFixed(2)}×`,
          0.85,
        ),
      };
    }
    case "dividend.debt_to_ebitda_ttm": {
      if (m.debt_to_ebitda_ttm === null) return NO_DATA;
      return {
        raw: m.debt_to_ebitda_ttm,
        evidence: financialsEvidence(
          m,
          `${m.ticker}: total debt / EBITDA = ${m.debt_to_ebitda_ttm.toFixed(2)}×`,
          0.85,
        ),
      };
    }
    case "dividend.growth_5y_cagr": {
      if (m.growth_5y_cagr === null) return NO_DATA;
      return {
        raw: m.growth_5y_cagr,
        evidence: dividendEvidence(
          m,
          `${m.ticker}: 5y dividend CAGR ${pct(m.growth_5y_cagr)} (complete calendar years)`,
          0.8,
        ),
      };
    }
    case "dividend.years_without_cut": {
      if (m.years_without_cut === null) return NO_DATA;
      return {
        raw: m.years_without_cut,
        evidence: dividendEvidence(
          m,
          `${m.ticker}: ${m.years_without_cut} consecutive complete year(s) without an annual dividend cut (within observed history)`,
          0.75,
        ),
      };
    }
    case "dividend.yield_zscore_24m": {
      if (m.yield_zscore_24m === null) return NO_DATA;
      // Confidence scales with history depth: 24 monthly points is the full
      // window, 8 is the floor where a norm barely exists.
      const confidence = Math.min(0.8, 0.4 + m.yieldHistoryPoints / 60);
      return {
        raw: m.yield_zscore_24m,
        evidence: derivedEvidence(
          `${m.ticker}: trailing yield is ${m.yield_zscore_24m.toFixed(2)} standard deviations from its ${m.yieldHistoryPoints}-month norm — a strongly positive value reads as cut risk (market repricing), not income opportunity`,
          confidence,
        ),
      };
    }
    case "dividend.ocf_yoy_change": {
      if (m.ocf_yoy_change === null) return NO_DATA;
      return {
        raw: m.ocf_yoy_change,
        evidence: financialsEvidence(
          m,
          `${m.ticker}: operating cash flow ${m.ocf_yoy_change >= 0 ? "up" : "down"} ${pct(Math.abs(m.ocf_yoy_change))} year-over-year`,
          0.7,
        ),
      };
    }
    default:
      return NO_DATA;
  }
}
