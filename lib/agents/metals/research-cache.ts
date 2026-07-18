import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";
import type { MetalsResearchGrade } from "./research";

/**
 * 30-day cache for the Metals desk's cost research (research_cache table,
 * migration 0009). AISC changes quarterly; the weekly cron re-using last
 * month's grade is analytically sound and cuts the desk's API cost ~90%.
 * Cache failures NEVER block a run — a miss or error just means the name is
 * researched live, exactly as before the cache existed.
 */

// v2 key: v1 entries pre-date the AISC plausibility bound and the
// grade-vs-AISC reconciliation, and at least one poisoned grade (AEM at
// 1/100 with a nonsense AISC) was cached under v1. Bumping the kind makes
// every v1 row a miss — names re-research through the new guards and the
// old rows age out harmlessly.
const KIND = "metals_cost_v2";
export const METALS_CACHE_MAX_AGE_DAYS = 30;

interface CacheRow {
  security_id: string;
  payload: MetalsResearchGrade;
  graded_at: string;
}

/** True when a cached grade is still inside the freshness window. */
export function isFresh(
  gradedAtIso: string,
  now: Date = new Date(),
  maxAgeDays: number = METALS_CACHE_MAX_AGE_DAYS,
): boolean {
  const age = now.getTime() - Date.parse(gradedAtIso);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeDays * 24 * 60 * 60 * 1000;
}

/** Fresh cached grades for the given names; stale/absent ids are simply missing. */
export async function loadCachedGrades(
  securityIds: string[],
): Promise<Map<string, MetalsResearchGrade>> {
  const out = new Map<string, MetalsResearchGrade>();
  if (securityIds.length === 0) return out;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("research_cache")
      .select("security_id, payload, graded_at")
      .eq("kind", KIND)
      .in("security_id", securityIds)
      .returns<CacheRow[]>();
    if (error) throw error;
    for (const row of data ?? []) {
      if (!isFresh(row.graded_at)) continue;
      const p = row.payload;
      // Defensive: only trust a payload that still looks like a grade.
      if (p && typeof p.costMarginGrade === "number" && typeof p.headline === "string") {
        out.set(row.security_id, p);
      }
    }
  } catch (err) {
    console.warn(`metals research cache read failed: ${getErrorMessage(err)}`);
  }
  return out;
}

/** Upsert freshly-researched grades. Best-effort — a write failure never throws. */
export async function saveCachedGrades(
  grades: Map<string, MetalsResearchGrade>,
): Promise<void> {
  if (grades.size === 0) return;
  try {
    const supabase = createServiceClient();
    const rows = [...grades.entries()].map(([security_id, payload]) => ({
      security_id,
      kind: KIND,
      payload,
      graded_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("research_cache")
      .upsert(rows, { onConflict: "security_id,kind" });
    if (error) throw error;
  } catch (err) {
    console.warn(`metals research cache write failed: ${getErrorMessage(err)}`);
  }
}
