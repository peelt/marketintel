import type { EvidenceItem, ScoringFramework } from "@/lib/agents/types";

/**
 * Result of resolving one sub-signal for one candidate.
 *
 * `raw` is the unnormalised value (e.g. EV/EBITDA = 6.2). `evidence` captures
 * what the resolver read to produce that value — flows through to the report's
 * `evidence` table so the chat layer can audit and defend the score.
 */
export interface SignalValue {
  raw: number | null;
  evidence: EvidenceItem[];
}

/**
 * A SignalResolver maps a declarative source_query string to a numeric value
 * for a given security. Agents register their own resolvers — there's no
 * global resolver. Generic infrastructure stays out of the way of domain
 * specifics (a dividend yield resolver belongs to the dividend agent).
 *
 * Return null when the data isn't available for this candidate. The engine
 * treats null as "skip this signal for this candidate" rather than penalising.
 */
export type SignalResolver = (params: {
  securityId: string;
  sourceQuery: string;
}) => Promise<SignalValue>;

/**
 * Batch path: resolve one sub-signal for MANY candidates in a single call —
 * typically one DB round-trip instead of N. Return a map keyed by securityId;
 * omitted candidates are treated as null signals.
 */
export type BatchSignalResolver = (params: {
  securityIds: string[];
  sourceQuery: string;
}) => Promise<Map<string, SignalValue>>;

export interface SignalResolverRegistry {
  resolve: SignalResolver;
  /**
   * Optional. When present the engine prefers it — required in practice for
   * large universes (the Reaction Analyser's ~500–800 names would otherwise
   * make N sequential round-trips per sub-signal).
   */
  resolveBatch?: BatchSignalResolver;
}

/**
 * Output of the scoring engine for one candidate.
 */
export interface CandidateScore {
  securityId: string;
  composite: number; // 0–100
  /**
   * 0–1: the share of framework weight that had data behind it
   * (Σ criterionWeight × presentSubSignalWeight). A composite built from one
   * signal out of ten is flagged, not silently confident.
   */
  coverage: number;
  criteria: Record<
    string,
    {
      /** null = no data for any sub-signal of this criterion (NOT zero). */
      score: number | null;
      signals: Record<
        string,
        { raw: number | null; normalised: number | null; weight: number }
      >;
    }
  >;
  evidence: EvidenceItem[];
}

export interface ScoringRunInput {
  framework: ScoringFramework;
  candidates: string[]; // security UUIDs
  resolver: SignalResolverRegistry;
}
