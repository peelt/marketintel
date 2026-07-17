/**
 * Pure geometry for the criteria radar (components/criteria-radar.tsx).
 * Lives outside the component so tests import plain TS, not JSX.
 */
export function radarPoints(
  scores: number[],
  radius: number,
  center: number,
): Array<{ x: number; y: number }> {
  const n = scores.length;
  return scores.map((score, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = (Math.max(0, Math.min(100, score)) / 100) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  });
}
