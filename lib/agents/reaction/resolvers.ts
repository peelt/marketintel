import type { EvidenceItem } from "@/lib/agents/types";
import type { SignalResolverRegistry, SignalValue } from "@/lib/scoring/types";
import { mapWithConcurrency } from "@/lib/concurrency";
import { loadRecentSeries, type ReactionSecurity } from "./data";
import {
  discountToHigh,
  median,
  volumeSpike,
  type DropStats,
  type SessionRow,
} from "./metrics";
import {
  confidenceWeight,
  gradeReactionNews,
  type ReactionNewsGrade,
} from "./news";

/**
 * Reaction signal resolvers. The screen context (recent series + drop stats
 * for every screened name) is built by the agent during candidate
 * collection; deeper data (1y series, news grades) loads lazily for the
 * screened names only. News grades — the expensive deep-tier calls — are
 * fetched once per candidate with bounded concurrency and shared by both
 * LLM-backed signals. (The framework-v1 fundamentals resolvers were removed
 * with migration 0015 — their financials_snapshot inputs were never
 * populated by the source, so they resolved to no-data on every run.)
 */

/** LLM fan-out width: deep-tier web-search calls are slow and rate-limited. */
const NEWS_CONCURRENCY = 3;

export interface ReactionRunContext {
  securities: Map<string, ReactionSecurity>;
  /** ~100 calendar days of sessions per screened name. */
  screenSeries: Map<string, SessionRow[]>;
  stats: Map<string, DropStats>;
  /** Median 5-session return across the WHOLE broad universe (market context). */
  universeMedian5d: number | null;
  asOf: string;
}

const NO_DATA: SignalValue = { raw: null, evidence: [] };

export function createReactionResolver(
  ctx: ReactionRunContext,
): SignalResolverRegistry {
  let yearSeriesPromise: Promise<Map<string, SessionRow[]>> | null = null;
  const newsGrades = new Map<string, Promise<ReactionNewsGrade | null>>();

  function yearSeries(ids: string[]): Promise<Map<string, SessionRow[]>> {
    yearSeriesPromise ??= loadRecentSeries(ids, 400);
    return yearSeriesPromise;
  }

  async function newsFor(ids: string[]): Promise<Map<string, ReactionNewsGrade | null>> {
    const missing = ids.filter((id) => !newsGrades.has(id));
    if (missing.length > 0) {
      // Kick off all missing grades with bounded concurrency, memoised so the
      // second news-backed signal reuses the same promise per candidate.
      const started = new Map<string, Promise<ReactionNewsGrade | null>>();
      const runAll = mapWithConcurrency(missing, NEWS_CONCURRENCY, async (id) => {
        const security = ctx.securities.get(id);
        const stats = ctx.stats.get(id);
        if (!security || !stats) return null;
        return gradeReactionNews({
          ticker: security.ticker,
          exchange: security.exchange,
          name: security.name,
          return1d: stats.return1d,
          return5d: stats.return5d,
          asOf: ctx.asOf,
        });
      });
      missing.forEach((id, idx) => {
        started.set(
          id,
          runAll.then((grades) => grades[idx]),
        );
      });
      for (const [id, promise] of started) newsGrades.set(id, promise);
    }
    const out = new Map<string, ReactionNewsGrade | null>();
    for (const id of ids) {
      out.set(id, await (newsGrades.get(id) ?? Promise.resolve(null)));
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
      case "reaction.excess_drop_5d": {
        for (const id of securityIds) {
          const stats = ctx.stats.get(id);
          const security = ctx.securities.get(id);
          if (!stats || stats.return5d === null || ctx.universeMedian5d === null || !security) {
            out.set(id, NO_DATA);
            continue;
          }
          const excess = ctx.universeMedian5d - stats.return5d; // positive = fell more than market
          out.set(id, {
            raw: excess,
            evidence: [
              derived(
                `${security.ticker}: 5-session return ${pct(stats.return5d)} vs broad-universe median ${pct(ctx.universeMedian5d)} — ${pct(excess)} worse than the market`,
                0.85,
              ),
            ],
          });
        }
        return out;
      }
      case "reaction.volume_spike": {
        for (const id of securityIds) {
          const series = ctx.screenSeries.get(id);
          const security = ctx.securities.get(id);
          const spike = series ? volumeSpike(series) : null;
          if (spike === null || !security) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: spike,
            evidence: [
              derived(
                `${security.ticker}: recent volume ${spike.toFixed(1)}× its 30-session baseline`,
                0.7,
              ),
            ],
          });
        }
        return out;
      }
      case "reaction.discount_to_52w_high": {
        const series = await yearSeries(securityIds);
        for (const id of securityIds) {
          const security = ctx.securities.get(id);
          const discount = discountToHigh(series.get(id) ?? []);
          if (discount === null || !security) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: discount,
            evidence: [
              derived(
                `${security.ticker}: trading ${pct(discount)} below its trailing-year high`,
                0.8,
              ),
            ],
          });
        }
        return out;
      }
      case "reaction.news_damage_grade": {
        const grades = await newsFor(securityIds);
        for (const id of securityIds) {
          const grade = grades.get(id);
          const security = ctx.securities.get(id);
          if (!grade || !security) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: grade.damageSeverity,
            evidence: [newsEvidence(security.ticker, grade)],
          });
        }
        return out;
      }
      case "reaction.overshoot_grade": {
        const grades = await newsFor(securityIds);
        for (const id of securityIds) {
          const grade = grades.get(id);
          const security = ctx.securities.get(id);
          if (!grade || !security) {
            out.set(id, NO_DATA);
            continue;
          }
          out.set(id, {
            raw: grade.disproportion,
            evidence: [
              derived(
                `${security.ticker}: disproportion graded ${grade.disproportion}/100 (${grade.confidence} confidence) — ${grade.headline}`,
                confidenceWeight(grade.confidence),
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

function derived(text: string, weight: number): EvidenceItem {
  return {
    type: "derived_metric",
    sourceTable: "derived",
    sourceId: "",
    text,
    weight,
  };
}

function newsEvidence(ticker: string, grade: ReactionNewsGrade): EvidenceItem {
  const sources = grade.sources.map((s) => `${s.title} — ${s.url}`).join("\n");
  return {
    type: "news_article",
    sourceTable: "web_search",
    sourceId: "",
    text: `[${ticker} · damage ${grade.damageSeverity}/100 · ${grade.confidence}] ${grade.headline}\n\n${grade.summary}${sources ? `\n\nSources:\n${sources}` : ""}`,
    weight: confidenceWeight(grade.confidence),
  };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
