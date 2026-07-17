import { criterionShortLabel } from "@/lib/format";
import { radarPoints } from "@/lib/radar";

/**
 * Criteria radar — the product's "score shape". One glanceable polygon drawn
 * from the framework's criterion scores (0–100), so the SHAPE of a candidate
 * is visible before any number is read: a full, even shape is strong across
 * the board; a spike is one-dimensional. Glass-box by construction — every
 * vertex IS a framework criterion, labelled; nothing is blended away.
 *
 * Null criteria (no data) are excluded rather than drawn at zero
 * (missing ≠ zero); fewer than three populated criteria can't make a
 * polygon, so the radar simply doesn't render and the tiles carry the story.
 */

export interface RadarCriterion {
  key: string;
  /** 0–100, or null = no data (excluded from the shape). */
  score: number | null;
}

// Wide enough that a centred label at the 3/9-o'clock vertices ("repricing")
// fits inside the viewBox — at 148px the left label clipped to "epricing".
const SIZE = 180;
const CENTER = SIZE / 2;
const RADIUS = 52;
const RINGS = [25, 50, 75, 100];


export function CriteriaRadar({
  criteria,
  color = "#034566",
}: {
  criteria: RadarCriterion[];
  color?: string;
}) {
  const populated = criteria.filter(
    (c): c is { key: string; score: number } => c.score !== null,
  );
  if (populated.length < 3) return null;

  const points = radarPoints(populated.map((c) => c.score), RADIUS, CENTER);
  const polygon = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const axes = populated.map((c, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / populated.length;
    return {
      key: c.key,
      score: c.score,
      x2: CENTER + RADIUS * Math.cos(angle),
      y2: CENTER + RADIUS * Math.sin(angle),
      lx: CENTER + (RADIUS + 14) * Math.cos(angle),
      ly: CENTER + (RADIUS + 14) * Math.sin(angle),
    };
  });

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Criteria shape: ${populated
        .map((c) => `${criterionShortLabel(c.key)} ${Math.round(c.score)}`)
        .join(", ")} out of 100`}
      className="shrink-0"
    >
      {RINGS.map((ring) => (
        <circle
          key={ring}
          cx={CENTER}
          cy={CENTER}
          r={(ring / 100) * RADIUS}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={ring === 100 ? 1.5 : 0.75}
        />
      ))}
      {axes.map((a) => (
        <line
          key={a.key}
          x1={CENTER}
          y1={CENTER}
          x2={a.x2}
          y2={a.y2}
          stroke="#e5e7eb"
          strokeWidth={0.75}
        />
      ))}
      <polygon
        points={polygon}
        fill={`${color}26`}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />
      ))}
      {axes.map((a) => (
        <text
          key={`label-${a.key}`}
          x={a.lx}
          y={a.ly}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fontFamily="var(--font-mono), monospace"
          fill="#6b7280"
        >
          {criterionShortLabel(a.key)}
        </text>
      ))}
    </svg>
  );
}
