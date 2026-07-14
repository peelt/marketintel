/**
 * Paginated reads. Supabase/PostgREST caps a single select at max_rows
 * (1,000 by default on hosted projects) and SILENTLY truncates beyond it —
 * a 27-name × 2-year price query already exceeds that, and the Reaction
 * screen (~850 names) is far past it. Every multi-thousand-row read must go
 * through here.
 *
 * `buildQuery` receives (from, to) and must return a fresh range-limited
 * query each call, ordered DETERMINISTICALLY (pagination over an unordered
 * set can skip/duplicate rows).
 */

const PAGE_SIZE = 1_000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`fetchAllRows(${label}) page ${page}: ${error.message}`);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}
