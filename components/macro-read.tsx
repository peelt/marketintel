import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { hostOf } from "@/lib/format";
import {
  confidenceColor,
  type ParsedMacroMemo,
} from "@/lib/reports/macro-memo";

/**
 * The Geopolitical macro read, rendered as accordions. Each theme shows its
 * title, a confidence pill, and the "which way it cuts" line at a glance; the
 * descriptive paragraph opens on demand. This keeps the backdrop's SHAPE above
 * the fold so the ranked table isn't pushed two screens down, while the full
 * read stays one click away — summary-and-detail, not a wall of prose.
 */
export function MacroRead({ memo }: { memo: ParsedMacroMemo }) {
  return (
    <div>
      <div className="font-mono-cli text-sm text-il-navy">~ macro read</div>
      {memo.intro && (
        <p className="mt-2 text-sm italic leading-relaxed text-muted-foreground">
          {memo.intro}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {memo.themes.map((t, i) => {
          const color = confidenceColor(t.confidence);
          return (
            <details
              key={i}
              className="group rounded-lg border border-border bg-white"
            >
              <summary className="cursor-pointer list-none px-4 py-3 marker:content-none">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-bold text-il-navy">{t.title}</span>
                  {t.confidence && (
                    <span
                      className="rounded-full px-2 py-0.5 font-mono-cli text-xs"
                      style={{ color, backgroundColor: `${color}1a` }}
                    >
                      {t.confidence} confidence
                    </span>
                  )}
                  <span
                    aria-hidden
                    className="ml-auto font-mono-cli text-muted-foreground transition-transform group-open:rotate-90"
                  >
                    ›
                  </span>
                </div>
                {t.cuts && (
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                    <span className="font-semibold text-il-navy">
                      Which way it cuts:{" "}
                    </span>
                    {t.cuts}
                  </p>
                )}
              </summary>
              {t.summary && (
                <div className="border-t border-border px-4 py-3 text-base leading-relaxed text-foreground">
                  {t.summary}
                </div>
              )}
            </details>
          );
        })}
      </div>

      {memo.sources.length > 0 && (
        <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono-cli text-xs text-muted-foreground">
          <span>sources:</span>
          {memo.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-il-navy underline decoration-border underline-offset-2 hover:text-il-orange"
            >
              {hostOf(s.url)}
            </a>
          ))}
        </p>
      )}

      {memo.scoringMarkdown && (
        <details className="mt-4">
          <summary className="cursor-pointer font-mono-cli text-sm text-muted-foreground marker:content-none hover:text-il-orange">
            ~ how this is scored
          </summary>
          <div className="md mt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {memo.scoringMarkdown}
            </ReactMarkdown>
          </div>
        </details>
      )}
    </div>
  );
}
