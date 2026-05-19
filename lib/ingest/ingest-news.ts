import { createServiceClient } from "@/lib/supabase/service";
import { resolveSecurityId } from "./resolve-security";
import type { RawNewsArticle } from "@/lib/data-sources/types";

export async function ingestNews(
  articles: RawNewsArticle[],
): Promise<{ inserted: number; skippedDuplicates: number }> {
  if (articles.length === 0) return { inserted: 0, skippedDuplicates: 0 };
  const supabase = createServiceClient();

  // Resolve any ticker tags to security UUIDs.
  const rows = await Promise.all(
    articles.map(async (a) => {
      const securities: string[] = [];
      for (const t of a.tickers ?? []) {
        // Tickers from RSS arrive without exchange; try US default first.
        const id = await resolveSecurityId(t, "NYSE")
          ?? await resolveSecurityId(t, "NASDAQ")
          ?? await resolveSecurityId(t, "LSE");
        if (id) securities.push(id);
      }
      return {
        source: a.source,
        url: a.url,
        title: a.title,
        content: a.content,
        summary: a.summary,
        published_at: a.publishedAt,
        securities,
        tags: a.tags ?? {},
        sentiment: a.sentiment,
      };
    }),
  );

  // Unique constraint is (source, url). On conflict do nothing — first write wins.
  const { error, count } = await supabase
    .from("news_articles")
    .upsert(rows, { onConflict: "source,url", ignoreDuplicates: true, count: "exact" });
  if (error) throw error;
  return {
    inserted: count ?? 0,
    skippedDuplicates: rows.length - (count ?? 0),
  };
}
