import Link from "next/link";
import { ClassificationChip } from "@/components/cli";
import { describeDelta, sortDeltasForFeed, type Delta } from "@/lib/holdings/deltas";
import type { PortfolioHealth } from "@/lib/holdings/deltas";

/**
 * Portfolio intel surfaces (6b) — the "what changed" feed and the health
 * roll-up. Server components (no interactivity). Every line is factual and
 * security-scoped; the feed sorts attention-first so a fresh cut-risk flag on a
 * held name is the first thing seen.
 */

export interface FeedItem {
  securityId: string;
  ticker: string;
  name: string;
  agentDisplay: string;
  delta: Delta;
}

const DIRECTION_GLYPH: Record<Delta["direction"], { glyph: string; color: string }> = {
  new: { glyph: "●", color: "#00b5e2" },
  worsened: { glyph: "▲", color: "#ee1d23" },
  improved: { glyph: "▼", color: "#22a87b" },
  resolved: { glyph: "✓", color: "#6b7280" },
  steady: { glyph: "·", color: "#9ca3af" },
};

/** The "what changed for your names since the last run" feed. */
export function WhatChangedFeed({
  items,
  limit,
}: {
  items: FeedItem[];
  limit?: number;
}) {
  // Only surface actual changes; "steady" verdicts belong in the holdings table.
  const changes = sortDeltasForFeed(
    items.filter((i) => i.delta.direction !== "steady"),
  );
  const shown = limit ? changes.slice(0, limit) : changes;

  if (changes.length === 0) {
    return (
      <p className="text-base text-muted-foreground">
        Nothing has changed for your holdings since the last desk runs. New
        flags and verdict changes on names you own will appear here.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {shown.map((item) => {
        const dir = DIRECTION_GLYPH[item.delta.direction];
        const cls = item.delta.latest?.classification ?? null;
        return (
          <li
            key={`${item.securityId}:${item.agentDisplay}`}
            className="card-cli flex items-start gap-3 px-4 py-3"
            style={
              item.delta.attention
                ? { borderColor: dir.color }
                : undefined
            }
          >
            <span
              aria-hidden
              className="mt-0.5 font-mono-cli text-base"
              style={{ color: dir.color }}
            >
              {dir.glyph}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={`/names/${item.securityId}`}
                  className="font-mono-cli text-base font-bold text-il-navy hover:text-il-orange"
                  title="See every desk's read on this name"
                >
                  {item.ticker}
                </Link>
                {cls && <ClassificationChip classification={cls} />}
                {item.delta.attention && (
                  <span className="font-mono-cli text-sm font-bold" style={{ color: dir.color }}>
                    needs a look
                  </span>
                )}
              </div>
              <p className="mt-1 text-base leading-relaxed text-foreground">
                {describeDelta(item.delta, item.ticker, item.agentDisplay)}
              </p>
            </div>
            {item.delta.latest?.reportId && (
              <Link
                href={`/reports/${item.delta.latest.reportId}`}
                className="shrink-0 font-mono-cli text-sm text-il-accent hover:text-il-orange"
              >
                report →
              </Link>
            )}
          </li>
        );
      })}
      {limit && changes.length > limit && (
        <li className="px-1 font-mono-cli text-sm text-muted-foreground">
          ~ {changes.length - limit} more on the portfolio page
        </li>
      )}
    </ul>
  );
}

/** Aggregate framework health across held names. */
export function PortfolioHealthBar({ health }: { health: PortfolioHealth }) {
  if (health.covered === 0) {
    return (
      <p className="text-base text-muted-foreground">
        None of your holdings have been covered by a desk yet. Coverage builds
        as the desks run — dividend names on Fridays, drops on Tue/Fri.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <span className="font-mono-cli text-base text-il-navy">
        <strong>{health.covered}</strong> covered
      </span>
      <span className="font-mono-cli text-base" style={{ color: health.flagged > 0 ? "#ee1d23" : "#22a87b" }}>
        <strong>{health.flagged}</strong> flagged
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {health.byClassification.map((c) => (
          <span key={c.classification} className="flex items-center gap-1.5">
            <span className="font-mono-cli text-base text-il-navy">{c.count}×</span>
            <ClassificationChip classification={c.classification} />
          </span>
        ))}
      </span>
    </div>
  );
}
