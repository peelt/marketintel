/**
 * Dependency-free server-rendered price line. Pure SVG — no client JS, no
 * chart library; the report page stays a fully static server component.
 */

export interface PricePoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export function PriceChart({
  points,
  currency,
  width = 560,
  height = 120,
}: {
  points: PricePoint[];
  currency?: string | null;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        Not enough price history to chart.
      </p>
    );
  }

  // Downsample long daily series so the polyline stays light.
  const step = Math.max(1, Math.floor(points.length / 120));
  const sampled = points.filter(
    (_, i) => i % step === 0 || i === points.length - 1,
  );

  const closes = sampled.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 6;

  const coords = sampled.map((p, i) => {
    const x = pad + (i / (sampled.length - 1)) * (width - 2 * pad);
    const y = pad + (1 - (p.close - min) / span) * (height - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const first = sampled[0];
  const last = sampled[sampled.length - 1];
  const change = (last.close - first.close) / first.close;
  const rising = change >= 0;

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Price history ${first.date} to ${last.date}`}
      >
        {/* Family illustration language: navy line-art; alert green/red only
            for the small change glyph, never as large fills. */}
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="#034566"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="font-mono-cli mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>
          {first.date} · {formatClose(first.close)}
          {currency ? ` ${currency}` : ""}
        </span>
        <span style={{ color: rising ? "#8DC73F" : "#EE1D23" }}>
          {rising ? "+" : ""}
          {(change * 100).toFixed(1)}%
        </span>
        <span>
          {last.date} · {formatClose(last.close)}
          {currency ? ` ${currency}` : ""}
        </span>
      </figcaption>
    </figure>
  );
}

function formatClose(v: number): string {
  return v >= 1000 ? v.toFixed(0) : v.toFixed(2);
}
