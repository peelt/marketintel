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

// Versioned kind: a parser or prompt fix bumps this so every prior row misses
// and re-grades through the new logic (the metals lesson — there is otherwise
// no lever to evict a poisoned eval, because discovery only surfaces original
// S-1/F-1 forms, never the S-1/A amendment that would change the accession).
const KIND = "ipo_eval_v2";
export const IPO_CACHE_MAX_AGE_DAYS = 30;

export interface CachedIpoEval extends IpoEval {
  accession: string;
}

interface CacheRow {
  security_id: string;
  payload: CachedIpoEval;
  graded_at: string;
}

/**
 * The grade fields a usable cached payload must carry. Validating the WHOLE
 * shape (not just accession + headline) means a future schema change — a new
 * required field — leaves old rows failing this check and re-grading, rather
 * than being read back with an `undefined` grade that scores as null.
 */
const REQUIRED_GRADE_KEYS: (keyof IpoEval)[] = [
  "businessQualityGrade",
  "growthGrade",
  "riskGrade",
  "governanceGrade",
  "offeringTermsGrade",
  "headline",
  "summary",
  "isShellOrSpac",
  "confidence",
];

/** Pure usability check — exported for tests. */
export function cacheUsable(
  payload: (Partial<CachedIpoEval> & { accession?: unknown }) | null,
  gradedAtIso: string,
  expectedAccession: string,
  now: Date = new Date(),
): boolean {
  if (!payload || payload.accession !== expectedAccession) return false;
  // Full-shape guard: every grade field must be present and of the right type.
  const p = payload as Record<string, unknown>;
  for (const key of REQUIRED_GRADE_KEYS) {
    const v = p[key];
    if (key === "isShellOrSpac") {
      if (typeof v !== "boolean") return false;
    } else if (
      key === "headline" ||
      key === "summary" ||
      key === "confidence"
    ) {
      if (typeof v !== "string") return false;
    } else if (typeof v !== "number") {
      return false;
    }
  }
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
