/**
 * Agent contract.
 *
 * Every "pole" implements this interface. The orchestrator (PR 3) and the
 * follow-up chat layer (PR 7) both depend only on this contract — keeps them
 * agnostic to the specifics of any one agent.
 *
 * Concrete implementations land in subsequent PRs:
 *   PR 4 — dividend
 *   PR 5 — ipo
 *   PR 6 — energy, metals
 *   PR 7 — geopolitical
 */

export type AgentName =
  | "ipo"
  | "dividend"
  | "geopolitical"
  | "energy"
  | "metals";

export interface AgentMeta {
  name: AgentName;
  displayName: string;
  description: string;
  /** Cron expression in Inngest format (UTC). */
  schedule: string;
  /** Default Anthropic model — sonnet for routine, opus for deep synthesis. */
  defaultModel: "claude-sonnet-4-5" | "claude-opus-4-7";
}

/**
 * Evidence collected during the agent's research phase. Each item is persisted
 * to the `evidence` table so the follow-up chat can be constrained to cited
 * sources rather than hallucinating fresh ones.
 */
export interface EvidenceItem {
  type:
    | "filing_section"
    | "financial_snapshot"
    | "news_article"
    | "macro_indicator"
    | "price_snapshot"
    | "dividend_record"
    | "derived_metric";
  sourceTable: string;
  sourceId: string;
  /** Human-readable extract used when prompting the scoring LLM. */
  text: string;
  /** 0–1 weight the scorer applied. */
  weight: number;
  securityId?: string;
}

export interface ScoringFramework {
  id: string;
  agentName: AgentName;
  version: number;
  criteria: ScoringCriterion[];
}

export interface ScoringCriterion {
  key: string;
  /** 0–1; sums to 1 across all criteria for one framework. */
  weight: number;
  subSignals: {
    key: string;
    /** 0–1; sums to 1 within a criterion. */
    weight: number;
    direction: "higher_better" | "lower_better";
    /** Declarative selector — interpreted by the scoring engine in PR 3. */
    sourceQuery: string;
  }[];
}

export interface ScoredCandidate {
  securityId: string;
  composite: number; // 0–100
  breakdown: Record<string, { score: number; signals: Record<string, number> }>;
  evidenceRefs: number[]; // indexes into the EvidenceItem array for this run
}

export interface RankedReport {
  agentName: AgentName;
  generatedAt: string; // ISO
  summaryMarkdown: string;
  ranked: ScoredCandidate[];
  evidence: EvidenceItem[];
}

export interface AgentRunInput {
  /** Override the default framework version. */
  frameworkId?: string;
  /** Manual trigger context, if any. */
  reason?: string;
}

export interface Agent {
  meta: AgentMeta;
  run(input: AgentRunInput): Promise<RankedReport>;
}
