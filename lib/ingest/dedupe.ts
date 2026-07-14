/**
 * In-batch dedupe before upserts.
 *
 * Postgres rejects a single upsert statement that touches the same conflict
 * key twice ("ON CONFLICT DO UPDATE command cannot affect row a second
 * time"), so every ingest batch must be unique on its conflict key BEFORE it
 * reaches supabase. Later occurrences win — batches are ordered oldest-first
 * by convention, so the freshest report of a row is the one persisted.
 */
export function dedupeBy<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(keyOf(row), row);
  }
  return [...byKey.values()];
}
