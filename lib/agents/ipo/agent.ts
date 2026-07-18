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
import { discoverIpoFilings, readProspectus } from "./discovery";
import { loadCachedEvals, saveCachedEvals, type CachedIpoEval } from "./eval-cache";
import { applyProposedTicker, upsertIpoIssuers } from "./issuers";
import { classifyIpo, MIN_COVERAGE_TO_CLASSIFY } from "./metrics";
import { isPlaceholderTicker } from "@/lib/format";
import { evaluateProspectus, type IpoEval } from "./research";
import { createIpoResolver, type IpoCandidate, type IpoRunContext } from "./resolvers";

/**
 * IPO desk (PR 8): a weekly league table of fresh S-1/F-1 registrants,
 * each evaluated FROM ITS OWN PROSPECTUS — no web search, no price data
 * (there is none yet). Five calibrated absolute grades (business quality,
 * growth, risk, governance, offering terms) rank the pipeline; shells and
 * blank-check registrants are identified and set aside rather than graded
 * as if they ran a business.
 *
 * Classifications are impersonal profile descriptions
 * (strong/mixed/weak profile), never directives (I2).
 */

// Prospectus evaluations carry ~25k input tokens each; three in flight keeps
// a full 25-issuer discovery inside the Inngest route's 800s budget.
const EVAL_CONCURRENCY = 3;

export class IpoAgent extends BaseAgent {
  readonly meta: AgentMeta = agentRegistry.get("ipo")!;
  protected override coverageFloor = MIN_COVERAGE_TO_CLASSIFY;

  private ctx: IpoRunContext | null = null;

  protected async collectCandidates(
    _framework: ScoringFramework,
    _input: AgentRunInput,
  ): Promise<string[]> {
    const asOf = new Date().toISOString().slice(0, 10);
    const filings = await discoverIpoFilings();
    const issuers = await upsertIpoIssuers(filings);

    const entries = filings.flatMap((filing) => {
      const cik = filing.issuerCik;
      const issuer = cik ? issuers.get(cik) : undefined;
      if (!cik || !issuer || !filing.accessionNumber) return [];
      return [{ filing, issuer, accession: filing.accessionNumber }];
    });

    const accessionById = new Map(
      entries.map((e) => [e.issuer.securityId, e.accession]),
    );
    const cached = await loadCachedEvals(accessionById);
    const misses = entries.filter((e) => !cached.has(e.issuer.securityId));

    const missEvals = await mapWithConcurrency(
      misses,
      EVAL_CONCURRENCY,
      async (e): Promise<{ eval: IpoEval | null; unreadable: boolean }> => {
        const readable = await readProspectus(e.filing);
        if (!readable) return { eval: null, unreadable: true };
        const evaluation = await evaluateProspectus({
          name: e.issuer.ticker.startsWith("CIK")
            ? (e.filing.issuerName ?? e.issuer.ticker)
            : `${e.filing.issuerName ?? ""} (${e.issuer.ticker})`,
          filingType: e.filing.filingType,
          filedAt: e.filing.filedAt,
          excerpt: readable.excerpt,
          asOf,
        });
        return { eval: evaluation, unreadable: false };
      },
    );

    const freshForCache = new Map<string, CachedIpoEval>();
    misses.forEach((e, idx) => {
      const evaluation = missEvals[idx].eval;
      if (evaluation) {
        freshForCache.set(e.issuer.securityId, {
          ...evaluation,
          accession: e.accession,
        });
      }
    });
    await saveCachedEvals(freshForCache);

    const candidates = new Map<string, IpoCandidate>();
    const unreadable: string[] = [];
    for (const e of entries) {
      const missIdx = misses.indexOf(e);
      const evaluation =
        cached.get(e.issuer.securityId) ??
        (missIdx >= 0 ? missEvals[missIdx].eval : null);
      if (missIdx >= 0 && missEvals[missIdx].unreadable) {
        unreadable.push(e.filing.issuerName ?? e.issuer.ticker);
      }
      const ticker = await applyProposedTicker(
        e.issuer.securityId,
        e.issuer.ticker,
        evaluation?.proposedTicker ?? null,
      );
      candidates.set(e.issuer.securityId, {
        securityId: e.issuer.securityId,
        cik: e.issuer.cik,
        ticker,
        name: e.filing.issuerName ?? ticker,
        filingType: e.filing.filingType,
        filedAt: e.filing.filedAt,
        accession: e.accession,
        filingUrl: e.filing.url,
        eval: evaluation,
      });
    }

    this.ctx = { candidates, unreadable, asOf };
    return [...candidates.keys()];
  }

  protected getResolver(_framework: ScoringFramework): SignalResolverRegistry {
    if (!this.ctx) throw new Error("ipo: resolver requested before candidates");
    return createIpoResolver(this.ctx);
  }

  protected override classify(scored: CandidateScore): {
    verdict?: string | null;
    classification?: string | null;
  } {
    return classifyIpo(scored, this.classifyFacts(scored.securityId));
  }

  /**
   * Shells and evaluation failures rank below fully-evaluated operating
   * companies — a shell's grades describe a different kind of entity, and a
   * missing evaluation is missing defining evidence.
   */
  protected override demoteFromRanking(scored: CandidateScore): boolean {
    const evaluation = this.ctx?.candidates.get(scored.securityId)?.eval;
    return (
      scored.coverage < this.coverageFloor ||
      !evaluation ||
      evaluation.isShellOrSpac
    );
  }

  private classifyFacts(securityId: string): { isShellOrSpac: boolean } {
    return {
      isShellOrSpac:
        this.ctx?.candidates.get(securityId)?.eval?.isShellOrSpac ?? false,
    };
  }

  protected async composeReport(input: {
    framework: ScoringFramework;
    scored: CandidateScore[];
    evidence: EvidenceItem[];
  }): Promise<{ summaryMarkdown: string; bodyMarkdown: string }> {
    const { framework, scored } = input;
    // Lead with the company name while the ticker is still a CIK placeholder —
    // a raw CIK is meaningless in a report a human reads.
    const label = (s: CandidateScore) => {
      const c = this.ctx?.candidates.get(s.securityId);
      if (!c) return "UNKNOWN";
      return isPlaceholderTicker(c.ticker) ? c.name : c.ticker;
    };
    const classified = scored.map((s) => ({
      s,
      ...classifyIpo(s, this.classifyFacts(s.securityId)),
    }));

    const strong = classified.filter((c) => c.classification === "strong_profile");
    const weak = classified.filter((c) => c.classification === "weak_profile");
    const shells = classified.filter(
      (c) => c.classification === "shell_or_blank_check",
    );
    const thin = classified.filter((c) => c.classification === "insufficient_data");
    const unreadableCount = this.ctx?.unreadable.length ?? 0;

    const summaryMarkdown = [
      `${scored.length} fresh S-1/F-1 registrant${scored.length === 1 ? "" : "s"} from the last 30 days evaluated from their own prospectuses against IPO framework v${framework.version}.`,
      strong.length
        ? `Strongest profiles: ${strong
            .slice(0, 3)
            .map((c) => `**${label(c.s)}** (${c.s.composite.toFixed(1)})`)
            .join(", ")}.`
        : "No filing reached the strongest band this run.",
      weak.length
        ? `${weak.length} profile${weak.length === 1 ? "" : "s"} graded weak: ${weak
            .map((c) => `**${label(c.s)}**`)
            .join(", ")}.`
        : "",
      shells.length
        ? `${shells.length} blank-check/shell registrant${shells.length === 1 ? "" : "s"} set aside.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    const lines: string[] = [
      `# IPO Evaluation`,
      ``,
      summaryMarkdown,
      ``,
      `## How this is scored`,
      ``,
      `Framework v${framework.version} weighs ${framework.criteria
        .map((c) => `${c.key.replace(/_/g, " ")} (${Math.round(c.weight * 100)}%)`)
        .join(", ")}. Every grade is read from the registrant's OWN prospectus —`,
      `the filing is the evidence source, linked from each candidate's rows. Grades are`,
      `0–100 absolute, calibrated across IPOs and time, so this week's table is comparable`,
      `to any other week's. Blank-check/shell registrants are identified and set aside`,
      `rather than scored as operating businesses.`,
      ``,
      `## Profiles`,
      ``,
    ];

    for (const c of classified) {
      if (
        c.classification === "insufficient_data" ||
        c.classification === "shell_or_blank_check"
      ) {
        continue;
      }
      lines.push(
        `- **${label(c.s)}** — ${String(c.classification).replace(/_/g, " ")} (composite ${c.s.composite.toFixed(1)}, coverage ${Math.round(c.s.coverage * 100)}%). ${c.verdict ?? ""}`,
      );
    }

    if (shells.length) {
      lines.push(
        ``,
        `## Set aside — blank-check / shell registrants`,
        ``,
        `${shells.map((c) => `**${label(c.s)}**`).join(", ")} registered without an operating business to evaluate.`,
      );
    }

    if (thin.length || unreadableCount > 0) {
      const notes: string[] = [];
      if (thin.length) {
        notes.push(
          `${thin.map((c) => `**${label(c.s)}**`).join(", ")}: the prospectus evaluation did not complete, so no profile is assigned.`,
        );
      }
      if (unreadableCount > 0) {
        notes.push(
          `${unreadableCount} filing${unreadableCount === 1 ? "" : "s"} couldn't be read into sections this run (${this.ctx?.unreadable.join(", ")}) — they re-qualify automatically next run.`,
        );
      }
      lines.push(``, `## Not evaluated`, ``, notes.join(" "));
    }

    lines.push(
      ``,
      `_Every grade above is defensible from the filing excerpts cited on each candidate — open one to see exactly what was read._`,
    );

    return { summaryMarkdown, bodyMarkdown: lines.join("\n") };
  }
}

export const ipoAgent = new IpoAgent();
export { classifyIpo };
