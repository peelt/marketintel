import { BaseAgent } from "../base";
import { agentRegistry } from "../registry";
import type {
  AgentMeta,
  AgentRunInput,
  EvidenceItem,
  ScoringFramework,
} from "../types";
import type { CandidateScore, SignalResolverRegistry } from "@/lib/scoring/types";
import { createDividendResolver } from "./resolvers";
import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";

/**
 * Dividend Intelligence — the credibility pole (PR 4).
 *
 * Screens the high-yield watchlist against the active dividend framework and
 * files a ranked, evidence-backed report with cut-risk callouts. Fully
 * quantitative in v1: every signal resolves from ingested financials, prices
 * and dividend history — no LLM in the scoring path, so the report is
 * reproducible from its evidence rows alone.
 *
 * Language discipline (I2): classifications describe the SECURITY under the
 * published framework ("elevated_cut_risk"), never a recommendation to a
 * person. The disclaimer surface renders alongside every report.
 */

const CLASSIFICATIONS = [
  "resilient",
  "watch",
  "elevated_cut_risk",
  "insufficient_data",
] as const;
export type DividendClassification = (typeof CLASSIFICATIONS)[number];

/** Below this coverage the framework hasn't seen enough data to classify. */
const MIN_COVERAGE_TO_CLASSIFY = 0.35;
/** cut_risk_signals criterion score (0–100, higher = safer) bands. */
const CUT_RISK_ELEVATED_BELOW = 35;
const CUT_RISK_WATCH_BELOW = 55;

export class DividendAgent extends BaseAgent {
  readonly meta: AgentMeta = agentRegistry.get("dividend")!;

  protected async collectCandidates(
    _framework: ScoringFramework,
    _input: AgentRunInput,
  ): Promise<string[]> {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("securities")
      .select("id")
      .contains("tags", ["high_yield_watchlist"])
      .is("delisted_at", null)
      .returns<{ id: string }[]>();
    if (error) {
      throw new Error(`dividend collectCandidates: ${getErrorMessage(error)}`);
    }
    return (data ?? []).map((r) => r.id);
  }

  protected getResolver(_framework: ScoringFramework): SignalResolverRegistry {
    return createDividendResolver();
  }

  protected override classify(scored: CandidateScore): {
    verdict?: string | null;
    classification?: string | null;
  } {
    return classifyDividend(scored);
  }

  protected async composeReport(input: {
    framework: ScoringFramework;
    scored: CandidateScore[];
    evidence: EvidenceItem[];
  }): Promise<{ summaryMarkdown: string; bodyMarkdown: string }> {
    const { framework, scored } = input;
    const tickers = await this.tickerMap(scored.map((s) => s.securityId));
    const label = (s: CandidateScore) => tickers.get(s.securityId) ?? "UNKNOWN";

    const classified = scored.map((s) => ({ s, ...this.classify(s) }));
    const flagged = classified.filter(
      (c) => c.classification === "elevated_cut_risk" || c.classification === "watch",
    );
    const thin = classified.filter((c) => c.classification === "insufficient_data");
    const avgCoverage =
      scored.reduce((sum, s) => sum + s.coverage, 0) / Math.max(1, scored.length);

    const top = scored.slice(0, 5);
    const summaryMarkdown = [
      `${scored.length} high-yield names screened against dividend framework v${framework.version}.`,
      top.length
        ? `Top ranked: ${top
            .slice(0, 3)
            .map((s) => `**${label(s)}** (${s.composite.toFixed(1)})`)
            .join(", ")}.`
        : "",
      flagged.length
        ? `${flagged.length} name(s) carry cut-risk flags: ${flagged
            .map((c) => `**${label(c.s)}**`)
            .join(", ")}.`
        : "No cut-risk flags this run.",
    ]
      .filter(Boolean)
      .join(" ");

    const lines: string[] = [
      `# Dividend Intelligence`,
      ``,
      summaryMarkdown,
      ``,
      `## How this is scored`,
      ``,
      `Framework v${framework.version} weighs ${framework.criteria
        .map((c) => `${c.key.replace(/_/g, " ")} (${Math.round(c.weight * 100)}%)`)
        .join(", ")}. A yield spike relative to a name's own 24-month norm scores`,
      `*against* it — the framework reads it as the market pricing a cut, not as income opportunity.`,
      `Signals without data redistribute their weight and are reported as coverage, never as zeros.`,
      ``,
      `## Leaders`,
      ``,
    ];

    for (const s of top) {
      const c = classified.find((x) => x.s === s)!;
      lines.push(
        `- **${label(s)}** — composite ${s.composite.toFixed(1)}, coverage ${Math.round(s.coverage * 100)}%, ${c.classification}. ${c.verdict ?? ""}`,
      );
    }

    if (flagged.length) {
      lines.push(``, `## Cut-risk callouts`, ``);
      for (const c of flagged) {
        lines.push(
          `- **${label(c.s)}** (${c.classification}, composite ${c.s.composite.toFixed(1)}) — ${c.verdict ?? ""}`,
        );
      }
    }

    if (thin.length) {
      lines.push(
        ``,
        `## Insufficient data`,
        ``,
        `${thin.map((c) => `**${label(c.s)}**`).join(", ")} fell below the ${Math.round(MIN_COVERAGE_TO_CLASSIFY * 100)}% coverage floor. Their composites are shown with coverage attached; classifications are withheld.`,
      );
    }

    lines.push(
      ``,
      `_Average framework coverage this run: ${Math.round(avgCoverage * 100)}%. Every score above is defensible from its cited evidence rows — open a candidate to inspect them._`,
    );

    return { summaryMarkdown, bodyMarkdown: lines.join("\n") };
  }

  private async tickerMap(securityIds: string[]): Promise<Map<string, string>> {
    if (securityIds.length === 0) return new Map();
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("securities")
      .select("id, ticker")
      .in("id", securityIds)
      .returns<{ id: string; ticker: string }[]>();
    if (error) throw new Error(`dividend tickerMap: ${getErrorMessage(error)}`);
    return new Map((data ?? []).map((r) => [r.id, r.ticker]));
  }
}

/**
 * Pure classification: coverage floor first (missing ≠ zero — a thin
 * composite is withheld, not classified), then cut-risk bands. Exported for
 * unit tests; the language stays security-scoped per I2.
 */
export function classifyDividend(scored: CandidateScore): {
  verdict: string;
  classification: DividendClassification;
} {
  if (scored.coverage < MIN_COVERAGE_TO_CLASSIFY) {
    return {
      classification: "insufficient_data",
      verdict: `Only ${Math.round(scored.coverage * 100)}% of framework weight had data — classification withheld rather than guessed.`,
    };
  }

  const cutRisk = scored.criteria["cut_risk_signals"]?.score ?? null;
  const flags = describeRiskDrivers(scored);

  if (cutRisk !== null && cutRisk < CUT_RISK_ELEVATED_BELOW) {
    return {
      classification: "elevated_cut_risk",
      verdict: `Cut-risk signals rank in the weakest band of this screen${flags ? ` — ${flags}` : ""}.`,
    };
  }
  if (cutRisk !== null && cutRisk < CUT_RISK_WATCH_BELOW) {
    return {
      classification: "watch",
      verdict: `Mixed cut-risk signals under framework scrutiny${flags ? ` — ${flags}` : ""}.`,
    };
  }
  return {
    classification: "resilient",
    verdict:
      flags.length > 0
        ? `Framework scores the payout as sustainable, with caveats — ${flags}.`
        : "Framework scores the payout as sustainable on current evidence.",
  };
}

/** Human-readable risk drivers from raw signal values (facts, not advice). */
function describeRiskDrivers(scored: CandidateScore): string {
  const notes: string[] = [];
  const sustain = scored.criteria["coverage_and_sustainability"]?.signals;
  const cut = scored.criteria["cut_risk_signals"]?.signals;

  const fcf = sustain?.["fcf_dividend_cover_ttm"]?.raw;
  if (fcf != null && fcf < 1) notes.push(`free cash flow covers only ${fcf.toFixed(2)}× the payout`);

  const payout = sustain?.["payout_ratio_ttm"]?.raw;
  if (payout != null && payout > 0.9) notes.push(`payout ratio ${Math.round(payout * 100)}% of earnings`);

  const z = cut?.["yield_z_score_24m"]?.raw;
  if (z != null && z > 1.5) notes.push(`yield ${z.toFixed(1)}σ above its 24-month norm`);

  const ocf = cut?.["ocf_yoy_change"]?.raw;
  if (ocf != null && ocf < -0.15) notes.push(`operating cash flow down ${Math.round(Math.abs(ocf) * 100)}% year-over-year`);

  return notes.join("; ");
}

export const dividendAgent = new DividendAgent();
