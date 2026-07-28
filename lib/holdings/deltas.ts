/**
 * Portfolio delta engine — pure, unit-testable. Given a held name's latest and
 * previous verdict from the SAME desk, decide what changed and whether the
 * holder should look now. This is the core of the intel lens (6b): the single
 * highest-value event the product can emit is "a desk just flagged a name you
 * own."
 *
 * Vocabulary-agnostic: each classification carries a concern rank (higher =
 * more attention-worthy for a holder) and a `flagged` bit. Direction is derived
 * from the ranks; attention fires on a NEW flag or a WORSENING into one, never
 * on an improvement (good news isn't urgent). Every sentence stays
 * security-scoped and factual (I2) — it describes the security's classification,
 * never advises the holder.
 */

interface Severity {
  rank: number;
  flagged: boolean;
}

/**
 * Concern rank per classification. Dividend: resilient(safe) → watch →
 * elevated_cut_risk(worst). Reaction: any classified appearance means the name
 * cleared the sharp-drop screen, so all are flagged; overshoot ranks above a
 * proportionate fall. insufficient_data carries no information → rank 0.
 */
const SEVERITY: Record<string, Severity> = {
  // dividend
  resilient: { rank: 0, flagged: false },
  watch: { rank: 2, flagged: true },
  elevated_cut_risk: { rank: 3, flagged: true },
  // reaction (a held name in a reaction report dropped hard this run)
  proportionate: { rank: 1, flagged: true },
  underreaction: { rank: 2, flagged: true },
  mild_overshoot: { rank: 2, flagged: true },
  strong_overshoot: { rank: 3, flagged: true },
  // it dropped hard and we don't know why — for a holder that IS attention
  cause_unconfirmed: { rank: 2, flagged: true },
  // a split or consolidation is not a fall — never a holder's concern
  corporate_action: { rank: 0, flagged: false },
  // metals: a weak position on a held producer deserves a look; mixed doesn't
  well_positioned: { rank: 0, flagged: false },
  mixed: { rank: 1, flagged: false },
  vulnerable: { rank: 3, flagged: true },
  // ipo (pre-listing names can't be held today; mapped for completeness)
  strong_profile: { rank: 0, flagged: false },
  mixed_profile: { rank: 1, flagged: false },
  weak_profile: { rank: 2, flagged: true },
  shell_or_blank_check: { rank: 0, flagged: false },
  // geopolitical: a held name graded at_risk against the backdrop deserves a look
  beneficiary: { rank: 0, flagged: false },
  at_risk: { rank: 3, flagged: true },
  insulated: { rank: 0, flagged: false },
  // shared (mixed reused by metals + geopolitical)
  insufficient_data: { rank: 0, flagged: false },
};

export function severityOf(classification: string | null): Severity {
  if (!classification) return { rank: 0, flagged: false };
  return SEVERITY[classification] ?? { rank: 1, flagged: true };
}

export interface VerdictSnapshot {
  agentName: string;
  classification: string | null;
  composite: number | null;
  coverage: number | null;
  runAt: string;
  reportId: string;
}

export type DeltaDirection =
  | "new" // newly appeared / newly classified
  | "worsened" // moved to a higher concern rank
  | "improved" // moved to a lower concern rank
  | "resolved" // was present, now absent or unflagged
  | "steady"; // unchanged

export interface Delta {
  direction: DeltaDirection;
  /** The holder should look now — a fresh flag or a worsening into one. */
  attention: boolean;
  latest: VerdictSnapshot | null;
  previous: VerdictSnapshot | null;
}

export function computeDelta(
  latest: VerdictSnapshot | null,
  previous: VerdictSnapshot | null,
): Delta {
  const l = severityOf(latest?.classification ?? null);
  const p = severityOf(previous?.classification ?? null);

  // No current verdict: either never covered (both null → steady) or it left
  // the screen (previous existed → resolved; good news, low urgency).
  if (!latest) {
    return {
      direction: previous ? "resolved" : "steady",
      attention: false,
      latest,
      previous,
    };
  }

  if (!previous) {
    return { direction: "new", attention: l.flagged, latest, previous };
  }

  if (latest.classification === previous.classification) {
    return { direction: "steady", attention: false, latest, previous };
  }

  if (l.rank > p.rank) {
    return { direction: "worsened", attention: l.flagged, latest, previous };
  }
  if (l.rank < p.rank) {
    return { direction: "improved", attention: false, latest, previous };
  }
  // Same rank, different label (e.g. mild_overshoot ↔ underreaction): a change
  // worth showing in the feed, but not an escalation.
  return { direction: "steady", attention: false, latest, previous };
}

/**
 * Impersonal, factual sentence for a delta. Kept pure (takes the display
 * strings) so it's testable and never drifts into advice.
 */
export function describeDelta(
  delta: Delta,
  ticker: string,
  agentDisplayName: string,
): string {
  const { direction, latest, previous } = delta;
  const cls = (c: string | null) => (c ? c.replace(/_/g, " ") : "no classification");
  switch (direction) {
    case "new":
      return `${agentDisplayName} newly classifies ${ticker} as ${cls(
        latest?.classification ?? null,
      )}.`;
    case "worsened":
      return `${agentDisplayName} moved ${ticker} from ${cls(
        previous?.classification ?? null,
      )} to ${cls(latest?.classification ?? null)}.`;
    case "improved":
      return `${agentDisplayName} moved ${ticker} from ${cls(
        previous?.classification ?? null,
      )} to ${cls(latest?.classification ?? null)}.`;
    case "resolved":
      return `${ticker} no longer clears the ${agentDisplayName} screen (was ${cls(
        previous?.classification ?? null,
      )}).`;
    case "steady":
      return `${agentDisplayName} classifies ${ticker} as ${cls(
        latest?.classification ?? null,
      )} — unchanged.`;
  }
}

/** Rank order for a feed: attention first, then by concern rank, then recency. */
export function sortDeltasForFeed<T extends { delta: Delta }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.delta.attention !== b.delta.attention) return a.delta.attention ? -1 : 1;
    const ar = severityOf(a.delta.latest?.classification ?? null).rank;
    const br = severityOf(b.delta.latest?.classification ?? null).rank;
    if (ar !== br) return br - ar;
    const at = a.delta.latest?.runAt ?? "";
    const bt = b.delta.latest?.runAt ?? "";
    return bt.localeCompare(at);
  });
}

/** Aggregate portfolio health across held names' latest verdicts. */
export interface PortfolioHealth {
  covered: number; // held names with any verdict
  flagged: number; // held names whose latest verdict is flagged
  byClassification: Array<{ classification: string; count: number }>;
}

export function summarizeHealth(
  latestByName: Array<{ classification: string | null }>,
): PortfolioHealth {
  const counts = new Map<string, number>();
  let covered = 0;
  let flagged = 0;
  for (const { classification } of latestByName) {
    if (!classification) continue;
    covered++;
    if (severityOf(classification).flagged) flagged++;
    counts.set(classification, (counts.get(classification) ?? 0) + 1);
  }
  const byClassification = [...counts.entries()]
    .map(([classification, count]) => ({ classification, count }))
    .sort((a, b) => severityOf(b.classification).rank - severityOf(a.classification).rank);
  return { covered, flagged, byClassification };
}
