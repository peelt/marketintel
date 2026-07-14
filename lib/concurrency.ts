/**
 * Bounded-concurrency map. Preserves input order in the result; runs at most
 * `limit` calls in flight. Rejects on the first error (a scoring run with a
 * broken resolver should fail loudly, not partially).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error(`mapWithConcurrency: limit must be >= 1, got ${limit}`);
  const results: R[] = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Split into consecutive chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error(`chunk: size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
