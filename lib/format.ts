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

/** Money in a currency, no decimals for large sums. Null → em dash (missing ≠ zero). */
export function formatMoney(amount: number | null, currency: string): string {
  if (amount == null) return "—";
  const abs = Math.abs(amount);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: abs >= 1000 ? 0 : 2,
  }).format(amount);
}

/** Signed money ("+£120", "−£45"). Null → em dash. */
export function formatSignedMoney(amount: number | null, currency: string): string {
  if (amount == null) return "—";
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${formatMoney(Math.abs(amount), currency)}`;
}

/** Signed percentage from a fraction (0.1 → "+10.0%"). Null → em dash. */
export function formatSignedPercent(fraction: number | null): string {
  if (fraction == null) return "—";
  const pct = fraction * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

/** Colour for a signed figure: green up, red down, muted flat/unknown. */
export function changeColor(amount: number | null): string {
  if (amount == null || amount === 0) return "#6b7280";
  return amount > 0 ? "#22a87b" : "#ee1d23";
}

/**
 * Parsed structure of a Reaction news-evidence row. The agent persists these
 * as `[TICKER · damage N/100 · confidence] headline\n\nsummary\n\nSources:\n
 * title — url` — this parser turns that back into renderable parts so the
 * report can show a designed card (badges, paragraphs, clickable sources)
 * instead of a wall of text. Null when the text doesn't match (caller falls
 * back to plain rendering) — works for already-persisted rows, no backfill.
 */
export interface ParsedNewsEvidence {
  ticker: string;
  /** What was graded — "damage" (Reaction) or "cost margin" (Metals). */
  gradeLabel: string;
  grade: number | null;
  confidence: string | null;
  headline: string;
  summary: string;
  sources: { title: string; url: string }[];
}

export function parseNewsEvidence(text: string): ParsedNewsEvidence | null {
  const head =
    /^\[([^\]·]+)·\s*([a-z][a-z ]*?)\s+(\d{1,3})\/100\s*·\s*(\w+)\]\s*/.exec(text);
  if (!head) return null;

  const rest = text.slice(head[0].length);
  const [beforeSources, sourcesBlock] = splitOnce(rest, /\n\s*Sources:\s*\n?/);
  const paragraphs = beforeSources.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const headline = paragraphs[0] ?? "";
  const summary = paragraphs.slice(1).join("\n\n");

  const sources: { title: string; url: string }[] = [];
  if (sourcesBlock) {
    // One per line: "Title — url". Older rows may run them together; also
    // sweep for bare URLs so nothing is lost.
    for (const line of sourcesBlock.split("\n")) {
      const m = /^(.*?)\s+—\s+(https?:\/\/\S+)\s*$/.exec(line.trim());
      if (m) sources.push({ title: m[1].trim(), url: m[2] });
    }
    if (sources.length === 0) {
      const urls = sourcesBlock.match(/https?:\/\/\S+/g) ?? [];
      const titles = sourcesBlock.split(/https?:\/\/\S+/).map((t) =>
        t.replace(/\s*—\s*$/, "").trim(),
      );
      urls.forEach((url, i) =>
        sources.push({ title: titles[i] || hostOf(url), url }),
      );
    }
  }

  return {
    ticker: head[1].trim(),
    gradeLabel: head[2].trim(),
    grade: Number.isFinite(Number(head[3])) ? Number(head[3]) : null,
    confidence: head[4] ?? null,
    headline,
    summary,
    sources,
  };
}

/** Hostname for display ("ts2.tech") — falls back to the raw string. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function splitOnce(text: string, re: RegExp): [string, string | null] {
  const m = re.exec(text);
  if (!m) return [text, null];
  return [text.slice(0, m.index), text.slice(m.index + m[0].length)];
}
