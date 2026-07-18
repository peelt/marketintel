import type { EvidenceItem } from "@/lib/agents/types";
import type { SignalResolverRegistry, SignalValue } from "@/lib/scoring/types";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  loadLatestFinancials,
  loadRecentSeries,
  type ReactionFinancials,
} from "@/lib/agents/reaction/data";
import {
  discountToHigh,
  returnOverSessions,
  type SessionRow,
} from "@/lib/agents/reaction/metrics";
import { debtToEbitda, ttmDividendPerShare, trailingYield } from "@/lib/agents/dividend/metrics";
import { fcfYield, rsVsBenchmark } from "./metrics";
import { loadDividends, type MetalsSecurity } from "./data";
import { isStale, latestSessionDate } from "@/lib/data-sources/staleness";
import {
  confidenceWeight,
  gradeMetalsCost,
  reconcileCostGrade,
  type MetalHint,
  type MetalsResearchGrade,
} from "./research";
import { loadCachedGrades, saveCachedGrades } from "./research-cache";

/**
 * Metals signal resolvers. Deterministic signals load lazily from existing
 * tables (price series, financials, dividends — the reaction/dividend
 * loaders and pure metrics are reused, not duplicated). The expensive
 * deep-tier cost research is fetched once per candidate with bounded
 * concurrency, mirroring the Reaction news layer.
 */

// 23 names at width 4 ≈ 6 waves × ~60–90s — inside the Inngest route's 800s
// budget with margin. Width 3 was ~8 waves and did not fit.
const RESEARCH_CONCURRENCY = 4;
/** ~126 trading sessions ≈ 6 months; ~252 ≈ the trailing year. */
const SESSIONS_6M = 126;

export interface MetalsRunContext {
  securities: Map<string, MetalsSecurity>;
  /** GLD's security id — the gold benchmark for relative strength. */
  goldBenchmarkId: string | null;
  /** Spot context for the research prompt ("gold ~$2,610/oz"). */
  metalContext: string | null;
  /** Numeric spots for the deterministic margin cross-check. */
  goldSpotUsd: number | null;
  silverSpotUsd: number | null;
  asOf: string;
}

const NO_DATA: SignalValue = { raw: null, evidence: [] };

export function createMetalsResolver(ctx: MetalsRunContext): SignalResolverRegistry {
  let seriesPromise: Promise<Map<string, SessionRow[]>> | null = null;
  let financialsPromise: Promise<Map<string, ReactionFinancials>> | null = null;
  let dividendsPromise: ReturnType<typeof loadDividends> | null = null;
  const researchGrades = new Map<string, Promise<MetalsResearchGrade | null>>();

  function series(ids: string[]): Promise<Map<string, SessionRow[]>> {
    // Include the benchmark so relative strength reads from one load.
    const withBenchmark = ctx.goldBenchmarkId ? [...ids, ctx.goldBenchmarkId] : ids;
    seriesPromise ??= loadRecentSeries(withBenchmark, 400);
    return seriesPromise;
  }
  function financials(ids: string[]): Promise<Map<string, ReactionFinancials>> {
    financialsPromise ??= loadLatestFinancials(ids);
    return financialsPromise;
  }
  function dividends(ids: string[]) {
    dividendsPromise ??= loadDividends(ids);
    return dividendsPromise;
  }

  async function researchFor(
    ids: string[],
  ): Promise<Map<string, MetalsResearchGrade | null>> {
    const missing = ids.filter((id) => !researchGrades.has(id));
    if (missing.length > 0) {
      // Cost control: AISC changes quarterly, so serve fresh-enough grades
      // from the 30-day cache and pay for research only on the misses.
      const cached = await loadCachedGrades(missing);
      for (const [id, grade] of cached) {
        researchGrades.set(id, Promise.resolve(grade));
      }
      const toResearch = missing.filter((id) => !cached.has(id));

      if (toResearch.length > 0) {
        const runAll = mapWithConcurrency(
          toResearch,
          RESEARCH_CONCURRENCY,
          async (id) => {
            const security = ctx.securities.get(id);
            if (!security) return null;
            // Cache the MODEL grade untouched; reconciliation happens at the
            // point of use (resolveBatch) against the CURRENT spot, so a grade
            // served from the 30-day cache still reflects today's metal price,
            // not the price at research time.
            return gradeMetalsCost({
              ticker: security.ticker,
              exchange: security.exchange,
              name: security.name,
              kind: security.asset_class === "royalty" ? "royalty" : "miner",
              metalContext: ctx.metalContext,
              asOf: ctx.asOf,
            });
          },
        ).then(async (grades) => {
          const fresh = new Map<string, MetalsResearchGrade>();
          toResearch.forEach((id, idx) => {
            const g = grades[idx];
            if (g) fresh.set(id, g);
          });
          await saveCachedGrades(fresh);
          return grades;
        });
        toResearch.forEach((id, idx) => {
          researchGrades.set(
            id,
            runAll.then((grades) => grades[idx]),
          );
        });
      }
    }
    const out = new Map<string, MetalsResearchGrade | null>();
    for (const id of ids) {
      out.set(id, await (researchGrades.get(id) ?? Promise.resolve(null)));
    }
    return out;
  }

  async function resolveBatch(params: {
    securityIds: string[];
    sourceQuery: string;
  }): Promise<Map<string, SignalValue>> {
    const { securityIds, sourceQuery } = params;
    const out = new Map<string, SignalValue>();

    switch (sourceQuery) {
      case "metals.cost_margin_grade": {
        const grades = await researchFor(securityIds);
        for (const id of securityIds) {
          const raw = grades.get(id);
          const security = ctx.securities.get(id);
          if (!raw || !security) {
            out.set(id, NO_DATA);
            continue;
          }
          // Reconcile the model grade against the CURRENT spot, with the metal
          // taken from the security (never guessed from AISC magnitude). Both
          // the score `raw` and the evidence card use the reconciled grade, so
          // the badge and the number scoring reads always agree.
          const grade = reconcileCostGrade(
            raw,
            ctx.goldSpotUsd,
            ctx.silverSpotUsd,
            metalOf(security),
          );
          out.set(id, {
            raw: grade.costMarginGrade,
            evidence: [researchEvidence(security.ticker, grade)],
          });
        }
        return out;
      }
      case "metals.debt_to_ebitda_ttm": {
        const fins = await financials(securityIds);
        for (const id of securityIds) {
          const f = fins.get(id);
          const security = ctx.securities.get(id);
          const value = debtToEbitda(f?.total_debt, f?.ebitda);
          if (value == null || !f || !security) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: value,
            evidence: [
              financialEvidence(
                f.id,
                `${security.ticker}: total debt / EBITDA = ${value.toFixed(2)}× (period end ${f.period_end})`,
              ),
            ],
          });
        }
        return out;
      }
      case "metals.fcf_yield_ttm": {
        const fins = await financials(securityIds);
        for (const id of securityIds) {
          const f = fins.get(id);
          const security = ctx.securities.get(id);
          const value = fcfYield(f?.free_cash_flow, f?.market_cap);
          if (value == null || !f || !security) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: value,
            evidence: [
              financialEvidence(
                f.id,
                `${security.ticker}: free-cash-flow yield ${(value * 100).toFixed(1)}% on current market cap (period end ${f.period_end})`,
              ),
            ],
          });
        }
        return out;
      }
      case "metals.discount_to_52w_high": {
        const all = await series(securityIds);
        for (const id of securityIds) {
          const s = all.get(id) ?? [];
          const security = ctx.securities.get(id);
          const value = discountToHigh(s);
          // Stale prices would misstate the 52-week-high discount; withhold
          // rather than compute from a weeks-old close.
          if (
            value == null ||
            !security ||
            isStale(latestSessionDate(s), ctx.asOf)
          ) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: value,
            evidence: [
              derived(
                `${security.ticker}: trading ${(value * 100).toFixed(1)}% below its trailing-year high`,
                0.8,
              ),
            ],
          });
        }
        return out;
      }
      case "metals.rs_vs_gold_6m": {
        const all = await series(securityIds);
        const bench = ctx.goldBenchmarkId ? (all.get(ctx.goldBenchmarkId) ?? []) : [];
        const benchReturn = returnOverSessions(bench, SESSIONS_6M);
        // A stale GLD benchmark would be subtracted from fresh stock returns,
        // fabricating relative strength — the exact finding. If the benchmark
        // is stale, the whole signal is unreliable for every name.
        const benchStale = isStale(latestSessionDate(bench), ctx.asOf);
        for (const id of securityIds) {
          const security = ctx.securities.get(id);
          const nameSeries = all.get(id) ?? [];
          const value = rsVsBenchmark(
            returnOverSessions(nameSeries, SESSIONS_6M),
            benchReturn,
          );
          if (
            value == null ||
            !security ||
            benchStale ||
            isStale(latestSessionDate(nameSeries), ctx.asOf)
          ) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: value,
            evidence: [
              derived(
                `${security.ticker}: 6-month return ${(value >= 0 ? "+" : "")}${(value * 100).toFixed(1)}pp vs gold (GLD benchmark)`,
                0.75,
              ),
            ],
          });
        }
        return out;
      }
      case "metals.dividend_yield_ttm": {
        const [divs, all] = await Promise.all([
          dividends(securityIds),
          series(securityIds),
        ]);
        for (const id of securityIds) {
          const security = ctx.securities.get(id);
          const s = all.get(id) ?? [];
          const latestClose = s.length ? s[s.length - 1].close : null;
          const payments = (divs.get(id) ?? []).map((d) => ({
            exDate: d.ex_date,
            amount: d.amount,
          }));
          const dps = ttmDividendPerShare(payments, ctx.asOf);
          const value = trailingYield(dps, latestClose);
          // A stale close distorts the trailing yield (yield = DPS / price).
          if (
            value == null ||
            !security ||
            isStale(latestSessionDate(s), ctx.asOf)
          ) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: value,
            evidence: [
              derived(
                `${security.ticker}: trailing dividend yield ${(value * 100).toFixed(2)}% (${payments.length} payment(s) in the window)`,
                0.8,
              ),
            ],
          });
        }
        return out;
      }
      default: {
        for (const id of securityIds) out.set(id, NO_DATA);
        return out;
      }
    }
  }

  return {
    resolve: async ({ securityId, sourceQuery }) => {
      const batch = await resolveBatch({ securityIds: [securityId], sourceQuery });
      return batch.get(securityId) ?? NO_DATA;
    },
    resolveBatch,
  };
}

/**
 * The security's metal, for the deterministic margin cross-check. Read from
 * the sub_sector ("Gold", "Silver", "Silver/Gold" → silver); null for
 * royalty/streaming names with no single metal, where the check falls back to
 * the AISC-magnitude heuristic.
 */
function metalOf(security: MetalsSecurity): MetalHint {
  const s = (security.sub_sector ?? "").toLowerCase();
  if (s.includes("silver")) return "silver";
  if (s.includes("gold")) return "gold";
  return null;
}

function derived(text: string, weight: number): EvidenceItem {
  return {
    type: "derived_metric",
    sourceTable: "derived",
    sourceId: "",
    text,
    weight,
  };
}

function financialEvidence(sourceId: string, text: string): EvidenceItem {
  return {
    type: "financial_snapshot",
    sourceTable: "financials_snapshot",
    sourceId,
    text,
    weight: 0.8,
  };
}

function researchEvidence(ticker: string, grade: MetalsResearchGrade): EvidenceItem {
  const sources = grade.sources.map((s) => `${s.title} — ${s.url}`).join("\n");
  const aisc =
    grade.reportedAiscUsd != null
      ? ` · AISC ~$${Math.round(grade.reportedAiscUsd).toLocaleString("en-US")}/oz`
      : "";
  return {
    type: "news_article",
    sourceTable: "web_search",
    sourceId: "",
    // Same persisted SHAPE as the Reaction news layer (the report page's
    // structured card parses it), with the desk's own grade label — the badge
    // must say what was actually graded, never borrow "damage".
    text: `[${ticker} · cost margin ${grade.costMarginGrade}/100 · ${grade.confidence}] ${grade.headline}${aisc}\n\n${grade.summary}${sources ? `\n\nSources:\n${sources}` : ""}`,
    weight: confidenceWeight(grade.confidence),
  };
}
