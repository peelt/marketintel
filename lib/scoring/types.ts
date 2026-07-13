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

export interface SignalResolverRegistry {
  resolve: SignalResolver;
}

/**
 * Output of the scoring engine for one candidate.
 */
export interface CandidateScore {
  securityId: string;
  composite: number; // 0–100
  criteria: Record<
    string,
    {
      score: number;
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
