import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";
import type { IpoEval } from "./research";

/**
 * Cache for the IPO desk's prospectus evaluations (research_cache table,
 * migration 0009, kind 'ipo_eval'). An evaluation is a function of ONE
 * filing, so the payload pins the accession number: a cached row is only
 * served while it matches the issuer's latest discovered filing — an
 * amendment or refiling re-grades automatically. The 30-day freshness window
 * matches the discovery window, so entries age out with their filings.
 * Cache failures never block a run — a miss just means a live evaluation.
 */

const KIND = "ipo_eval";
export const IPO_CACHE_MAX_AGE_DAYS = 30;

export interface CachedIpoEval extends IpoEval {
  accession: string;
}

interface CacheRow {
  security_id: string;
  payload: CachedIpoEval;
  graded_at: string;
}

/** Pure usability check — exported for tests. */
export function cacheUsable(
  payload: { accession?: unknown; headline?: unknown } | null,
  gradedAtIso: string,
  expectedAccession: string,
  now: Date = new Date(),
): boolean {
  if (!payload || payload.accession !== expectedAccession) return false;
  if (typeof payload.headline !== "string") return false;
  const age = now.getTime() - Date.parse(gradedAtIso);
  return (
    Number.isFinite(age) &&
    age >= 0 &&
    age <= IPO_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  );
}

/**
 * Fresh cached evaluations whose accession still matches the issuer's latest
 * filing; everything else is simply missing.
 */
export async function loadCachedEvals(
  accessionBySecurityId: Map<string, string>,
): Promise<Map<string, IpoEval>> {
  const out = new Map<string, IpoEval>();
  const ids = [...accessionBySecurityId.keys()];
  if (ids.length === 0) return out;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("research_cache")
      .select("security_id, payload, graded_at")
      .eq("kind", KIND)
      .in("security_id", ids)
      .returns<CacheRow[]>();
    if (error) throw error;
    for (const row of data ?? []) {
      const expected = accessionBySecurityId.get(row.security_id);
      if (!expected) continue;
      if (!cacheUsable(row.payload, row.graded_at, expected)) continue;
      out.set(row.security_id, row.payload);
    }
  } catch (err) {
    console.warn(`ipo eval cache read failed: ${getErrorMessage(err)}`);
  }
  return out;
}

/** Upsert freshly-graded evaluations. Best-effort — a write failure never throws. */
export async function saveCachedEvals(
  evals: Map<string, CachedIpoEval>,
): Promise<void> {
  if (evals.size === 0) return;
  try {
    const supabase = createServiceClient();
    const rows = [...evals.entries()].map(([security_id, payload]) => ({
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
    console.warn(`ipo eval cache write failed: ${getErrorMessage(err)}`);
  }
}
