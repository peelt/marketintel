import { severityOf } from "@/lib/holdings/deltas";
import { classificationLabel } from "@/lib/format";

/**
 * The dashboard desk card's one-line signal — the SHAPE of the latest run,
 * not a log excerpt. "23 mixed · 15 beneficiary · 1 at risk" reads instantly
 * and carries no machine framing (no "framework v1", no "evaluated against …").
 *
 * Ordered by count (the run's honest composition, dominant classification
 * first); severity breaks ties so a flagged group outranks a benign one of the
 * same size. Capped to keep the card to one line.
 */

export interface ClassifiedLite {
  classification: string | null;
}

export function deskSignalLine(
  items: ClassifiedLite[],
  maxGroups = 3,
): string | null {
  const classified = items.filter((i) => i.classification);
  const total = classified.length;
  if (total === 0) return null;

  const counts = new Map<string, number>();
  for (const i of classified) {
    counts.set(i.classification!, (counts.get(i.classification!) ?? 0) + 1);
  }

  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // count desc
    return severityOf(b[0]).rank - severityOf(a[0]).rank; // then concern desc
  });

  const shown = groups
    .slice(0, maxGroups)
    .map(([cls, n]) => `${n} ${classificationLabel(cls)}`);
  const remainder = groups.length - Math.min(groups.length, maxGroups);
  const tail = remainder > 0 ? ` · +${remainder} more` : "";

  return `${total} ranked · ${shown.join(" · ")}${tail}`;
}
