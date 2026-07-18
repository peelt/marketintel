import { BaseAgent } from "@/lib/agents/base";
import { agentRegistry } from "@/lib/agents/registry";
import type {
  AgentMeta,
  AgentRunInput,
  EvidenceItem,
  ScoringFramework,
} from "@/lib/agents/types";
import type { CandidateScore, SignalResolverRegistry } from "@/lib/scoring/types";
import {
  goldBenchmarkId,
  loadMetalsUniverse,
  metalSpot,
  type MetalsSecurity,
} from "./data";
import { classifyMetals, MIN_COVERAGE_TO_CLASSIFY } from "./metrics";
import { createMetalsResolver, type MetalsRunContext } from "./resolvers";

/**
 * Precious Metals desk (PR 9): gold/silver producers and royalty/streaming
 * companies, scored on cost position (AISC vs the current metal price —
 * web-researched, absolute-calibrated), balance sheet, valuation vs own
 * history, and shareholder returns. ETFs are excluded from scoring: they
 * track the metal, and a producer framework says nothing about them.
 *
 * Classifications are impersonal position descriptions
 * (well_positioned / mixed / vulnerable), never directives (I2).
 */
export class MetalsAgent extends BaseAgent {
  readonly meta: AgentMeta = agentRegistry.get("metals")!;
  // Ranking and classification share the floor: a name too thin to classify
  // is also too thin to compete for rank.
  protected override coverageFloor = MIN_COVERAGE_TO_CLASSIFY;

  private ctx: MetalsRunContext | null = null;

  protected async collectCandidates(
    _framework: ScoringFramework,
    _input: AgentRunInput,
  ): Promise<string[]> {
    const [universe, benchmark, spot] = await Promise.all([
      loadMetalsUniverse(),
      goldBenchmarkId(),
      metalSpot(),
    ]);

    const securities = new Map<string, MetalsSecurity>();
    for (const s of universe) securities.set(s.id, s);

    this.ctx = {
      securities,
      goldBenchmarkId: benchmark,
      metalContext: spot.label,
      goldSpotUsd: spot.goldUsd,
      silverSpotUsd: spot.silverUsd,
      asOf: new Date().toISOString().slice(0, 10),
    };
    return universe.map((s) => s.id);
  }

  protected getResolver(_framework: ScoringFramework): SignalResolverRegistry {
    if (!this.ctx) throw new Error("metals: resolver requested before candidates");
    return createMetalsResolver(this.ctx);
  }

  protected override classify(scored: CandidateScore): {
    verdict?: string | null;
    classification?: string | null;
  } {
    return classifyMetals(scored);
  }

  protected async composeReport(input: {
    framework: ScoringFramework;
    scored: CandidateScore[];
    evidence: EvidenceItem[];
  }): Promise<{ summaryMarkdown: string; bodyMarkdown: string }> {
    const { framework, scored } = input;
    const label = (s: CandidateScore) =>
      this.ctx?.securities.get(s.securityId)?.ticker ?? "UNKNOWN";
    const classified = scored.map((s) => ({ s, ...classifyMetals(s) }));

    const well = classified.filter((c) => c.classification === "well_positioned");
    const vulnerable = classified.filter((c) => c.classification === "vulnerable");
    const thin = classified.filter((c) => c.classification === "insufficient_data");
    const avgCoverage =
      scored.reduce((sum, s) => sum + s.coverage, 0) / Math.max(1, scored.length);

    const summaryMarkdown = [
      `${scored.length} precious-metals producers and royalty companies screened against metals framework v${framework.version}${this.ctx?.metalContext ? ` (${this.ctx.metalContext})` : ""}.`,
      well.length
        ? `Strongest positions: ${well
            .slice(0, 3)
            .map((c) => `**${label(c.s)}** (${c.s.composite.toFixed(1)})`)
            .join(", ")}.`
        : "No name reached the strongest band this run.",
      vulnerable.length
        ? `${vulnerable.length} name(s) score in the weakest band: ${vulnerable
            .map((c) => `**${label(c.s)}**`)
            .join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    const lines: string[] = [
      `# Precious Metals`,
      ``,
      summaryMarkdown,
      ``,
      `## How this is scored`,
      ``,
      `Framework v${framework.version} weighs ${framework.criteria
        .map((c) => `${c.key.replace(/_/g, " ")} (${Math.round(c.weight * 100)}%)`)
        .join(", ")}. The anchor is the cost position: the latest reported AISC`,
      `(or stream economics for royalty companies) researched from company reporting and graded`,
      `0–100 absolute against the current metal price. Signals without data redistribute their`,
      `weight and are reported as coverage, never as zeros. ETFs are not scored — they track the metal.`,
      ``,
      `## Positions`,
      ``,
    ];

    for (const c of classified) {
      if (c.classification === "insufficient_data") continue;
      lines.push(
        `- **${label(c.s)}** — ${String(c.classification).replace(/_/g, " ")} (composite ${c.s.composite.toFixed(1)}, coverage ${Math.round(c.s.coverage * 100)}%). ${c.verdict ?? ""}`,
      );
    }

    if (thin.length) {
      lines.push(
        ``,
        `## Insufficient data`,
        ``,
        `${thin.map((c) => `**${label(c.s)}**`).join(", ")} fell below the ${Math.round(MIN_COVERAGE_TO_CLASSIFY * 100)}% coverage floor; classifications are withheld.`,
      );
    }

    lines.push(
      ``,
      `_Average framework coverage this run: ${Math.round(avgCoverage * 100)}%. Every score above is defensible from its cited evidence rows — open a candidate to inspect them._`,
    );

    return { summaryMarkdown, bodyMarkdown: lines.join("\n") };
  }
}

export const metalsAgent = new MetalsAgent();
export { classifyMetals };
