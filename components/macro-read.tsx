import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { hostOf } from "@/lib/format";
import {
  confidenceColor,
  type ParsedMacroMemo,
} from "@/lib/reports/macro-memo";

/** Themes named on the collapsed strip before it falls back to a count. */
const STRIP_CHIPS = 3;

/**
 * The macro read. Two renders of the same memo:
 *
 * `compact` (Reaction) — one strip: the heading plus the leading theme titles
 * as chips, everything else behind a click. Reaction's backdrop is CONTEXT for
 * a ranked table of names; rendered full it ran to a screen of general market
 * commentary sitting between the conclusion and the names it was meant to
 * support, which is what made the page hard to read.
 *
 * default (Geopolitical) — accordions, open on the page. There the memo IS the
 * report, so it earns the space; each theme shows its title, confidence and
 * "which way it cuts" at a glance with the detail one click away.
 */
export function MacroRead({
  memo,
  compact = false,
  driverLine = null,
}: {
  memo: ParsedMacroMemo;
  compact?: boolean;
  /** Reaction's attribution roll-up, shown under the chips (compact only). */
  driverLine?: string | null;
}) {
  if (compact) {
    const shown = memo.themes.slice(0, STRIP_CHIPS);
    const rest = memo.themes.length - shown.length;
    return (
      <details className="group">
        <summary className="cursor-pointer list-none marker:content-none">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono-cli text-sm text-il-navy">
              ~ macro read
            </span>
            {shown.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-sm text-foreground"
              >
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: confidenceColor(t.confidence) }}
                />
                {t.title}
              </span>
            ))}
            {rest > 0 && (
              <span className="font-mono-cli text-sm text-muted-foreground">
                +{rest} more
              </span>
            )}
            <span
              aria-hidden
              className="ml-auto font-mono-cli text-muted-foreground transition-transform group-open:rotate-90"
            >
              ›
            </span>
          </div>
          {driverLine && (
            <p className="mt-2 text-base leading-relaxed text-foreground">
              {driverLine}
            </p>
          )}
        </summary>
        <div className="mt-4 border-t border-border pt-4">
          <MacroBody memo={memo} />
        </div>
      </details>
    );
  }

  return (
    <div>
      <div className="font-mono-cli text-sm text-il-navy">~ macro read</div>
      <MacroBody memo={memo} />
    </div>
  );
}

function MacroBody({ memo }: { memo: ParsedMacroMemo }) {
  return (
    <>
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
        <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono-cli text-sm text-muted-foreground">
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
    </>
  );
}
