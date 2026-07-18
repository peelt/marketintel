import { BaseAgent } from "@/lib/agents/base";
import { agentRegistry } from "@/lib/agents/registry";
import type {
  AgentMeta,
  AgentRunInput,
  EvidenceItem,
  ScoringFramework,
} from "@/lib/agents/types";
import type { CandidateScore, SignalResolverRegistry } from "@/lib/scoring/types";
import { mapWithConcurrency } from "@/lib/concurrency";
import { hostOf } from "@/lib/format";
import { loadGeopoliticalUniverse, type GeopoliticalSecurity } from "./data";
import { researchMacroRead, themesForPrompt, type MacroRead } from "./macro";
import { classifyGeopolitical, MIN_COVERAGE_TO_CLASSIFY } from "./metrics";
import { gradeGeoExposure } from "./research";
import {
  createGeopoliticalResolver,
  type GeoCandidate,
  type GeoRunContext,
} from "./resolvers";

/**
 * Geopolitical desk (PR 10, the last desk): a weekly HYBRID report — a macro
 * read (the current geopolitical backdrop, with explicit confidence per
 * theme) over a ranked table of names scored on how they are POSITIONED for
 * that backdrop. One fresh web-research macro call anchors the run; each name
 * is then graded against those themes by one routine-tier call with NO
 * per-name web search (cheap, and positioning always reflects THIS week's
 * themes).
 *
 * Classifications are impersonal position descriptions
 * (beneficiary / mixed / at_risk / insulated), never directives (I2). The
 * desk never bets on an outcome — it grades exposure to the backdrop as it
 * stands.
 */

// ~38 names, no per-name web search; four in flight fits the 800s route budget.
const EXPOSURE_CONCURRENCY = 4;

export class GeopoliticalAgent extends BaseAgent {
  readonly meta: AgentMeta = agentRegistry.get("geopolitical")!;
  protected override coverageFloor = MIN_COVERAGE_TO_CLASSIFY;

  private ctx: GeoRunContext | null = null;
  private macro: MacroRead | null = null;

  protected async collectCandidates(
    _framework: ScoringFramework,
    _input: AgentRunInput,
  ): Promise<string[]> {
    const asOf = new Date().toISOString().slice(0, 10);
    const universe = await loadGeopoliticalUniverse();
    if (universe.length === 0) {
      this.ctx = { candidates: new Map(), asOf };
      return [];
    }

    // One fresh macro read anchors the whole run and grounds every grade.
    this.macro = await researchMacroRead(asOf);
    const themesBlock = this.macro
      ? themesForPrompt(this.macro)
      : "No current macro read was available this run.";

    const grades = await mapWithConcurrency(
      universe,
      EXPOSURE_CONCURRENCY,
      (s: GeopoliticalSecurity) =>
        gradeGeoExposure({
          ticker: s.ticker,
          name: s.name,
          sector: s.sector,
          subSector: s.sub_sector,
          themesBlock,
          asOf,
        }),
    );

    const candidates = new Map<string, GeoCandidate>();
    universe.forEach((s, idx) => {
      candidates.set(s.id, {
        securityId: s.id,
        ticker: s.ticker,
        name: s.name,
        grade: grades[idx],
      });
    });

    this.ctx = { candidates, asOf };
    return universe.map((s) => s.id);
  }

  protected getResolver(_framework: ScoringFramework): SignalResolverRegistry {
    if (!this.ctx) throw new Error("geopolitical: resolver requested before candidates");
    return createGeopoliticalResolver(this.ctx);
  }

  protected override classify(scored: CandidateScore): {
    verdict?: string | null;
    classification?: string | null;
  } {
    return classifyGeopolitical(scored);
  }

  protected async composeReport(input: {
    framework: ScoringFramework;
    scored: CandidateScore[];
    evidence: EvidenceItem[];
  }): Promise<{ summaryMarkdown: string; bodyMarkdown: string }> {
    const { framework, scored } = input;
    const label = (s: CandidateScore) =>
      this.ctx?.candidates.get(s.securityId)?.ticker ?? "UNKNOWN";
    const classified = scored.map((s) => ({ s, ...classifyGeopolitical(s) }));

    const beneficiaries = classified.filter((c) => c.classification === "beneficiary");
    const atRisk = classified.filter((c) => c.classification === "at_risk");
    const insulated = classified.filter((c) => c.classification === "insulated");
    const thin = classified.filter((c) => c.classification === "insufficient_data");

    const summaryMarkdown = [
      `${scored.length} geopolitically-exposed name${scored.length === 1 ? "" : "s"} graded against ${this.macro ? `${this.macro.themes.length} current backdrop theme${this.macro.themes.length === 1 ? "" : "s"}` : "the current backdrop"} (framework v${framework.version}).`,
      beneficiaries.length
        ? `Best positioned: ${beneficiaries
            .slice(0, 3)
            .map((c) => `**${label(c.s)}** (${c.s.composite.toFixed(1)})`)
            .join(", ")}.`
        : "No name reached the beneficiary band this run.",
      atRisk.length
        ? `${atRisk.length} graded at risk: ${atRisk.map((c) => `**${label(c.s)}**`).join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    // The macro read is the memo — rendered prominently (open) above the
    // table on the report page. Confidence is inline per theme.
    const lines: string[] = [`# Geopolitical Scanner`, ``];

    if (this.macro) {
      lines.push(`## Macro read`, ``, `_${this.macro.asOfNote}_`, ``);
      for (const t of this.macro.themes) {
        lines.push(
          `### ${t.title}  ·  confidence: ${t.confidence}`,
          ``,
          t.summary,
          ``,
          `**Which way it cuts:** ${t.direction}${t.affectedSectors.length ? `  ·  _${t.affectedSectors.join(", ")}_` : ""}`,
          ``,
        );
      }
      if (this.macro.sources.length) {
        lines.push(
          `**Sources:** ${this.macro.sources.map((s) => `[${hostOf(s.url)}](${s.url})`).join(" · ")}`,
          ``,
        );
      }
    } else {
      lines.push(
        `## Macro read`,
        ``,
        `_No current macro read was available this run — names are graded against no themes and classifications are withheld where the grade could not be produced._`,
        ``,
      );
    }

    // The per-name positions are the ranked table below the memo on the
    // report page — not repeated here. The memo carries the backdrop, the
    // scoring method, and the shape of the run (how many benefit vs. are at
    // risk) so the read stands on its own.
    lines.push(
      `## How this is scored`,
      ``,
      `Framework v${framework.version} weighs ${framework.criteria
        .map((c) => `${c.key.replace(/_/g, " ")} (${Math.round(c.weight * 100)}%)`)
        .join(", ")}. Each name in the table below is graded 0–100 absolute against the themes`,
      `above: positioning (beneficiary vs. threatened), resilience (how insulated), and materiality`,
      `(how much geopolitics bears on it at all). Names geopolitics barely touches are marked`,
      `insulated rather than forced into a call. This is exposure to the backdrop as it stands —`,
      `never a bet on an outcome.`,
      ``,
      `This run: ${beneficiaries.length} positioned to benefit, ${atRisk.length} at risk, ${insulated.length} largely insulated${thin.length ? `, ${thin.length} not graded (grading did not complete)` : ""}.`,
    );

    return { summaryMarkdown, bodyMarkdown: lines.join("\n") };
  }
}

export const geopoliticalAgent = new GeopoliticalAgent();
export { classifyGeopolitical };
