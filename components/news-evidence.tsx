import { hostOf, parseNewsEvidence } from "@/lib/format";

/**
 * Designed rendering for a Reaction news-evidence row: what happened, how bad
 * the news is (damage grade + research confidence), the readable summary, and
 * the sources as real links — replacing the wall-of-text blob. Falls back to
 * plain paragraphs when a row doesn't parse (nothing is ever hidden).
 */
export function NewsEvidenceCard({
  text,
  weight,
}: {
  text: string;
  weight: number;
}) {
  const parsed = parseNewsEvidence(text);

  if (!parsed) {
    return (
      <div className="rounded border border-border/60 bg-muted/20 px-4 py-3">
        <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
          news research · confidence {weight.toFixed(2)}
        </div>
        <p className="whitespace-pre-line text-base leading-relaxed">{text}</p>
      </div>
    );
  }

  // Badge colour follows the grade's polarity: "damage" is bad when high
  // (Reaction), margins/quality grades are good when high (Metals).
  const highIsBad = parsed.gradeLabel.includes("damage");
  const gradeColor =
    parsed.grade == null
      ? "#6b7280"
      : (highIsBad ? parsed.grade : 100 - parsed.grade) >= 60
        ? "#ee1d23"
        : (highIsBad ? parsed.grade : 100 - parsed.grade) >= 30
          ? "#f6881c"
          : "#22a87b";
  const heading = highIsBad
    ? "why it fell"
    : parsed.gradeLabel.includes("cost")
      ? "cost research"
      : parsed.gradeLabel.includes("positioning")
        ? "geopolitical position"
        : parsed.gradeLabel.includes("business")
          ? "prospectus research"
          : "research";

  return (
    <div className="rounded border border-border/60 bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {heading}
        </span>
        {parsed.grade != null && (
          <span
            className="rounded-full px-2.5 py-0.5 font-mono-cli text-sm"
            style={{ color: gradeColor, backgroundColor: `${gradeColor}1a` }}
          >
            {highIsBad ? "news damage" : parsed.gradeLabel} {parsed.grade}/100
          </span>
        )}
        {parsed.confidence && (
          <span className="font-mono-cli text-sm text-muted-foreground">
            {parsed.confidence} confidence
          </span>
        )}
      </div>

      <p className="mt-2 text-base font-bold leading-snug text-il-navy">
        {parsed.headline}
      </p>
      {parsed.summary && (
        <p className="mt-2 whitespace-pre-line text-base leading-relaxed">
          {parsed.summary}
        </p>
      )}

      {parsed.sources.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border/60 pt-3">
          {parsed.sources.map((s) => (
            <li key={s.url} className="flex items-baseline gap-2 text-sm">
              <span aria-hidden className="font-mono-cli text-il-orange">
                [*]
              </span>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate text-il-navy underline decoration-border underline-offset-2 hover:text-il-orange"
              >
                {s.title}
              </a>
              <span className="shrink-0 font-mono-cli text-muted-foreground">
                {hostOf(s.url)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
