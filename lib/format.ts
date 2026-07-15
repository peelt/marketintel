/**
 * Presentation helpers — pure, unit-tested, shared by the dashboard and
 * report surfaces. The UI never shows machine-speak (cron strings, raw
 * markdown, snake_case vocab); these are the translations.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Human schedule for the simple crons this product uses
 * ("M H * * D[,D…]" / "M H * * D-D" / "M H * * *"). Falls back to the raw
 * string for anything it can't confidently translate — never guesses.
 */
export function humanizeSchedule(cron: string): string {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:-[0-6])?(?:,[0-6])*)$/.exec(
    cron.trim(),
  );
  if (!m) return cron;
  const [, minute, hour, dowSpec] = m;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;

  if (dowSpec === "*") return `daily, ${time}`;
  const range = /^([0-6])-([0-6])$/.exec(dowSpec);
  if (range) {
    if (range[1] === "1" && range[2] === "5") return `weekdays, ${time}`;
    return `${DAY_NAMES[Number(range[1])]}–${DAY_NAMES[Number(range[2])]}, ${time}`;
  }
  const days = dowSpec.split(",").map((d) => DAY_NAMES[Number(d)]);
  return `${days.join(" & ")}, ${time}`;
}

/**
 * Next firing of a "M H * * D" style cron after `from`, as a short label
 * ("Fri 18:00 UTC" / "today 17:00 UTC"). Null when the cron isn't one of the
 * simple shapes above.
 */
export function nextRunLabel(cron: string, from: Date = new Date()): string | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:-[0-6])?(?:,[0-6])*)$/.exec(
    cron.trim(),
  );
  if (!m) return null;
  const [, minuteS, hourS, dowSpec] = m;
  const minute = Number(minuteS);
  const hour = Number(hourS);

  const allowedDays = new Set<number>();
  if (dowSpec === "*") {
    for (let d = 0; d < 7; d++) allowedDays.add(d);
  } else {
    const range = /^([0-6])-([0-6])$/.exec(dowSpec);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) allowedDays.add(d);
    } else {
      for (const d of dowSpec.split(",")) allowedDays.add(Number(d));
    }
  }

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(
      Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate() + offset,
        hour,
        minute,
      ),
    );
    if (candidate <= from) continue;
    if (!allowedDays.has(candidate.getUTCDay())) continue;
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`;
    return offset === 0
      ? `today ${time}`
      : `${DAY_NAMES[candidate.getUTCDay()]} ${time}`;
  }
  return null;
}

/**
 * Strip inline markdown (bold/italic/links/headings) for plain-text surfaces
 * like list summaries — raw `**asterisks**` leaking into the UI was a live
 * bug this exists to prevent.
 */
export function stripInlineMarkdown(markdown: string): string {
  return markdown
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** "today, 21:11" / "yesterday, 09:02" / "15 Jul, 21:11" (en-GB). */
export function humanizeDateTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const dayIso = d.toISOString().slice(0, 10);
  const nowIso = now.toISOString().slice(0, 10);
  const yesterdayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (dayIso === nowIso) return `today, ${time}`;
  if (dayIso === yesterdayIso) return `yesterday, ${time}`;
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    ...(d.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
  return `${date}, ${time}`;
}

/** snake_case classification → sentence label ("elevated_cut_risk" → "elevated cut risk"). */
export function classificationLabel(classification: string): string {
  return classification.replace(/_/g, " ");
}
