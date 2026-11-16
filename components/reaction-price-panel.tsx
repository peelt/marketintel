import { Skeleton } from "@/components/skeleton";
import {
  changeColor,
  formatPriceDate,
  formatShortDate,
  formatSignedPercent,
} from "@/lib/format";
import {
  chartGeometry,
  priceFormatter,
  quoteCaption,
  type ReactionPriceContext,
} from "@/lib/reports/reaction-price";

/**
 * The price behind a Reaction verdict, opened inside its ranked row. It sits
 * between the verdict sentence and the scores, because the verdict quotes a
 * move in percent and a reader checks it against the price on their own
 * screen first.
 *
 * Server-rendered, no client JS. Built from four layers:
 *  - the line: navy line-art (family language), no fill;
 *  - the fall window: a faint navy band over the sessions the verdict grades;
 *  - the graded close: a dot, plus a dashed level carried to the right edge,
 *    so whether the price has recovered since reads without a number;
 *  - a strip of the figures as real text: the exact values are here, and the
 *    chart only shows their shape.
 *
 * The SVG stretches to the panel (preserveAspectRatio="none"), and everything
 * that must stay round or legible (dots, labels, the dashed level) is HTML
 * positioned by percentage on top of it, so text never scales below the
 * 14px type floor on a narrow panel.
 */

const NAVY = "#034566";
/** Band and its legend swatch share one value so the key matches the chart. */
const BAND_OPACITY = 0.1;
const PANEL = "rounded border border-border bg-white";
const EYEBROW = "text-xs uppercase tracking-wider text-muted-foreground";

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

function windowLabel(sessions: number | null): string {
  if (sessions === 1) return "the one-session fall";
  if (sessions && sessions > 1) return `the ${sessions}-session fall`;
  return "the fall";
}

export function ReactionPricePanel({
  ctx,
  sessions,
  ticker,
}: {
  ctx: ReactionPriceContext;
  /** The screened window, as the verdict states it (1 or 5 sessions). */
  sessions: number | null;
  ticker: string;
}) {
  const { chart, screened, windowStart, high52, latest } = ctx;
  const money = priceFormatter(ctx);
  const canChart = chart.length >= 2;
  const geo = canChart ? chartGeometry(chart) : null;

  const sx = geo?.x(screened.date) ?? null;
  const sy = geo ? geo.y(screened.close) : null;
  const wx = windowStart && geo ? geo.x(windowStart.date) : null;
  const first = chart[0];
  const last = chart[chart.length - 1];

  const linePoints = geo
    ? chart
        .map((p, i) => {
          const x = (i / Math.max(1, chart.length - 1)) * 1000;
          return `${x.toFixed(1)},${(geo.y(p.close) * 100).toFixed(2)}`;
        })
        .join(" ")
    : "";

  const summary = [
    `${ticker} daily closes, ${formatPriceDate(first.date)} to ${formatPriceDate(last.date)}.`,
    windowStart
      ? `Fell from ${money(windowStart.close)} on ${formatPriceDate(windowStart.date)} to ${money(screened.close)} on ${formatPriceDate(screened.date)}.`
      : `Graded close ${money(screened.close)} on ${formatPriceDate(screened.date)}.`,
    latest
      ? `Latest close ${money(latest.close)} on ${formatPriceDate(latest.date)}, ${formatSignedPercent(latest.sinceFraction)} since.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={PANEL} aria-label={`${ticker} price`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3">
        <span className={EYEBROW}>Price · {quoteCaption(ctx)}</span>
        {canChart && (
          <span
            aria-hidden
            className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-cli text-sm text-muted-foreground"
          >
            {wx !== null && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: NAVY, opacity: BAND_OPACITY }}
                />
                {windowLabel(sessions)}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <GradedDot />
              graded close
            </span>
          </span>
        )}
      </header>

      {canChart && geo && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 pt-3">
          {/* Plot */}
          <div role="img" aria-label={summary} className="relative h-32 sm:h-36">
            {/* Fall window band. A one-session window is narrow on a
                three-month chart, so it is never drawn thinner than 6px. */}
            {wx !== null && sx !== null && (
              <div
                aria-hidden
                className="absolute inset-y-0 min-w-[6px]"
                style={{
                  left: pct(wx),
                  width: pct(sx - wx),
                  backgroundColor: NAVY,
                  opacity: BAND_OPACITY,
                }}
              />
            )}
            <svg
              aria-hidden
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              {/* Period high / low rules, labelled in the gutter. */}
              {[geo.max, geo.min].map((v, i) => (
                <line
                  key={i}
                  x1="0"
                  x2="1000"
                  y1={geo.y(v) * 100}
                  y2={geo.y(v) * 100}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <polyline
                points={linePoints}
                fill="none"
                stroke={NAVY}
                strokeWidth="1.75"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {/* The graded level, carried forward: is the price above or below
                where the desk graded it? Only when something has printed since. */}
            {sx !== null && sy !== null && latest && sx < 1 && (
              <div
                aria-hidden
                className="absolute right-0 border-t border-dashed"
                style={{ left: pct(sx), top: pct(sy), borderColor: NAVY, opacity: 0.45 }}
              />
            )}
            {sx !== null && sy !== null && (
              <span
                aria-hidden
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: pct(sx), top: pct(sy) }}
              >
                <GradedDot />
              </span>
            )}
          </div>

          {/* Y gutter: the period's high and low closes, level with their
              rules. The invisible copy of the wider label sizes the column. */}
          <div aria-hidden className="relative font-mono-cli text-sm text-muted-foreground">
            <span className="invisible block">
              {money(geo.max).length >= money(geo.min).length ? money(geo.max) : money(geo.min)}
            </span>
            {[geo.max, geo.min].map((v, i) => (
              <span
                key={i}
                className="absolute left-0 -translate-y-1/2 whitespace-nowrap"
                style={{ top: pct(geo.y(v)) }}
              >
                {money(v)}
              </span>
            ))}
          </div>

          {/* X axis: the charted span. */}
          <div
            aria-hidden
            className="flex justify-between pt-1.5 font-mono-cli text-sm text-muted-foreground"
          >
            <span>{formatPriceDate(first.date)}</span>
            <span>{formatPriceDate(last.date)}</span>
          </div>
          <span aria-hidden />
        </div>
      )}

      {/* The figures, as text. gap-px over a border-coloured ground draws
          the dividers in both the 2-column and 4-column layouts. */}
      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-b border-t border-border bg-border sm:grid-cols-4">
        <Fact
          label="Before the fall"
          value={windowStart ? money(windowStart.close) : "—"}
          note={
            windowStart
              ? `${formatShortDate(windowStart.date)} close`
              : "window start not on file"
          }
        />
        <Fact
          label={
            <span className="inline-flex items-center gap-1.5">
              <GradedDot />
              Graded close
            </span>
          }
          value={money(screened.close)}
          note={`${formatShortDate(screened.date)} close`}
        />
        <Fact
          label="52-week high"
          value={high52 ? money(high52.close) : "—"}
          note={
            high52 ? (
              <>
                {formatShortDate(high52.date)} close
                <br />
                graded close {(high52.belowFraction * 100).toFixed(1)}% below
              </>
            ) : (
              "under a year of price history"
            )
          }
        />
        <Fact
          label="Latest close"
          value={latest ? money(latest.close) : "—"}
          note={
            latest ? (
              <>
                {formatShortDate(latest.date)} close
                <br />
                <SignedMove fraction={latest.sinceFraction} /> since{" "}
                {formatShortDate(screened.date)}
              </>
            ) : (
              `nothing has closed since ${formatShortDate(screened.date)}`
            )
          }
        />
      </dl>
    </section>
  );
}

function Fact({
  label,
  value,
  note,
}: {
  label: React.ReactNode;
  value: string;
  note: React.ReactNode;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className={EYEBROW}>{label}</dt>
      <dd
        className={`mt-1 font-mono-cli text-base ${
          value === "—" ? "text-muted-foreground" : "text-il-navy"
        }`}
      >
        {value}
      </dd>
      <dd className="mt-0.5 text-sm leading-snug text-muted-foreground">{note}</dd>
    </div>
  );
}

/**
 * A move as a signed percent, coloured by direction — except one that rounds
 * to zero, which reads neutral: a green "+0.0%" claims a gain that isn't there.
 */
function SignedMove({ fraction }: { fraction: number }) {
  const flat = Math.abs(fraction) < 0.0005;
  return (
    <span
      className="font-bold"
      style={{ color: flat ? "#6b7280" : changeColor(fraction) }}
    >
      {flat ? "0.0%" : formatSignedPercent(fraction)}
    </span>
  );
}

function GradedDot() {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
      style={{ backgroundColor: NAVY }}
    />
  );
}

/** No price panel can be drawn: say why in one line (no unexplained absence). */
export function ReactionPriceUnavailable({ reason }: { reason: string }) {
  return (
    <section className={`${PANEL} px-4 py-3`}>
      <div className={EYEBROW}>Price</div>
      <p className="mt-1 text-sm leading-snug text-muted-foreground">{reason}</p>
    </section>
  );
}

/** Streaming fallback: the panel's shape, bars only (never fake figures). */
export function ReactionPriceSkeleton() {
  return (
    <div aria-hidden className={PANEL}>
      <div className="flex justify-between px-4 pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="px-4 pt-3">
        <Skeleton className="h-32 w-full sm:h-36" />
        <div className="flex justify-between pt-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 bg-white px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
