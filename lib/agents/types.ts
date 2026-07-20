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
  | "reaction"
  | "ipo"
  | "dividend"
  | "geopolitical"
  | "energy"
  | "metals";

export interface AgentMeta {
  name: AgentName;
  displayName: string;
  description: string;
  /**
   * Plain-English scope, shown under the report title on every edition: what
   * universe the desk covers, why a name is in or out, and how it's judged. The
   * reader should never have to guess why these names and not others.
   */
  scope: string;
  /** Cron expression in Inngest format (UTC). */
  schedule: string;
  /**
   * Model tier, not a model ID. Concrete IDs are pinned once in
   * lib/anthropic/client.ts (`MODELS`) so migrations are a one-file change.
   */
  modelTier: "routine" | "deep";
  /**
   * "live" = implemented and filing reports; "planned" = registry metadata
   * only. The dashboard renders live desks as signal cards and demotes
   * planned ones to a roadmap footnote — a card that can never file a report
   * must not look like a product surface.
   */
  status: "live" | "planned";
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
  /**
   * Agent-specific tunables that are DATA, not code — e.g. the Reaction
   * Analyser's inclusion thresholds (settled: 5d ≥12% OR 1d ≥8%). Editable
   * per framework version without redeploy, pinned like everything else.
   */
  params: Record<string, unknown>;
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
    /**
     * How the raw value becomes a 0–100 score:
     *   "rank"     (default) — percentile across the current candidate set.
     *               Relative: the worst candidate scores 0 regardless of merit.
     *   "zscore"   — z-score across the set mapped to 0–100. Relative, but
     *               respects distribution tails.
     *   "absolute" — the raw value IS the 0–100 score (clamped; inverted for
     *               lower_better). Use for LLM-calibrated grades and
     *               absolute-threshold signals so scores stay comparable
     *               across reports and over time.
     */
    normalisation?: "rank" | "zscore" | "absolute";
  }[];
}

export interface ScoredCandidate {
  securityId: string;
  composite: number; // 0–100
  /** 0–1: share of framework weight that actually had data behind it. */
  coverage: number;
  /**
   * Per-criterion scores. `null` means "no data" — deliberately distinct from
   * 0 ("worst"). The UI must never render a null as a zero.
   */
  breakdown: Record<
    string,
    { score: number | null; signals: Record<string, number | null> }
  >;
  /** Free-text verdict, e.g. Reaction's overshoot bands. Agent-assigned. */
  verdict?: string | null;
  /** Constrained classification, e.g. Metals' buy/hold/avoid. Agent-assigned. */
  classification?: string | null;
  evidenceRefs: number[]; // indexes into the EvidenceItem array for this run
}

export interface RankedReport {
  agentName: AgentName;
  generatedAt: string; // ISO
  summaryMarkdown: string;
  bodyMarkdown: string;
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
