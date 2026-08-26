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
/**
 * A few classification enums don't read well when merely de-snaked
 * ("insufficient data", "cause unconfirmed"): map those to plain reader
 * phrases. Everything else de-snakes fine ("weak profile", "at risk", …).
 * Criterion keys pass through untouched — none collide with these.
 */
const CLASSIFICATION_PHRASES: Record<string, string> = {
  insufficient_data: "not enough data",
  cause_unconfirmed: "cause not yet confirmed",
  corporate_action: "corporate action, not a fall",
  shell_or_blank_check: "shell / blank cheque",
};

export function classificationLabel(classification: string): string {
  return CLASSIFICATION_PHRASES[classification] ?? classification.replace(/_/g, " ");
}

/**
 * A 0–1 resolver confidence as a reader word. Humans read "high confidence",
 * not "confidence 0.85".
 */
export function confidenceWord(weight: number): "high" | "medium" | "low" {
  if (weight >= 0.8) return "high";
  if (weight >= 0.5) return "medium";
  return "low";
}

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A YYYY-MM-DD date → "21 Jul 2025" (day-month-year, the standard for a UK /
 * financial audience). Parsed from the string parts so it never shifts by a
 * timezone. Falls back to the raw string if it isn't a plain date.
 */
export function formatPriceDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = SHORT_MONTHS[Number(mo) - 1] ?? mo;
  return `${Number(d)} ${month} ${y}`;
}

/**
 * First non-empty line of a (markdown-stripped) summary, capped for list and
 * standfirst use. Pure; shared by the reports list and detail pages.
 */
export function firstSentences(text: string, max = 220): string {
  const flat = text.split("\n").filter((l) => l.trim().length > 0)[0] ?? "";
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The screened move a reaction verdict quotes — "-19.2% over 5 sessions" or
 * "-9.0% in a session" (see describeScreenedMove). Parsed back out so the
 * ranked table can show the fall itself without opening the row. Null when
 * the verdict doesn't quote a move (absent verdict, on-demand screen notes) —
 * the cell renders "—", never a fabricated number.
 */
export function parseVerdictDrop(
  verdict: string | null,
): { pct: number; sessions: 1 | 5 } | null {
  if (!verdict) return null;
  const m = /(-?\d+(?:\.\d+)?)% (over 5 sessions|in a session)/.exec(verdict);
  if (!m) return null;
  const pct = Number(m[1]);
  if (!Number.isFinite(pct)) return null;
  return { pct, sessions: m[2] === "in a session" ? 1 : 5 };
}

/** "-19.2% / 5d" — the drop cell's text. */
export function dropDisplay(drop: { pct: number; sessions: 1 | 5 }): string {
  return `${drop.pct.toFixed(1)}% / ${drop.sessions}d`;
}

/**
 * Summaries filed before the prose fix carry printf plurals — "3 move(s)",
 * "1 drop(s)". Filed editions are immutable, so old ones are normalised at
 * display time instead ("3 moves", "1 drop").
 */
export function pluralizeCounts(text: string): string {
  // The count may sit a word or two before the "(s)" noun — "4 graded
  // drop(s)", "2 screened fall(s)" — so allow short intermediates.
  return text.replace(
    /(\d+)((?:\s+[A-Za-z]+){0,2}?)\s+([A-Za-z]+)\(s\)/g,
    (_, num: string, mid: string, word: string) =>
      `${num}${mid} ${Number(num) === 1 ? word : `${word}s`}`,
  );
}

/**
 * An edition's line in the archive list. Every reaction summary opens with the
 * same "NNN names screened; " — identical on every row, so the list drops it
 * and each row leads with what that run actually found.
 */
export function editionListLine(summary: string): string {
  return pluralizeCounts(summary).replace(/^\d[\d,]* names screened; /, "");
}

/**
 * Pre-listing IPO issuers carry a placeholder ticker derived from their SEC
 * CIK ("CIK2102720") until the prospectus discloses a proposed symbol. A raw
 * CIK is meaningless to a reader, so display surfaces should lead with the
 * company name instead.
 */
export function isPlaceholderTicker(ticker: string): boolean {
  return /^CIK\d+$/.test(ticker);
}

/**
 * What to print in a security's bold "ticker" slot: the ticker — unless it's
 * a CIK placeholder, in which case the company name (the only legible
 * identity the issuer has yet).
 */
export function securityDisplayLabel(security: {
  ticker: string;
  name?: string | null;
}): string {
  if (isPlaceholderTicker(security.ticker) && security.name) {
    return security.name;
  }
  return security.ticker;
}

/**
 * The muted secondary line next to the bold label: the name — unless the name
 * IS the label (CIK placeholder), where repeating it says nothing and the
 * honest annotation is that no symbol exists yet.
 */
export function securitySecondaryLabel(security: {
  ticker: string;
  name?: string | null;
}): string {
  if (isPlaceholderTicker(security.ticker)) {
    return security.name ? "pre-listing · no ticker yet" : security.ticker;
  }
  return security.name ?? "";
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
 * Day change as a fraction of the PRIOR value (change / (value − change)).
 * Null when it can't be computed honestly — never a fabricated 0%.
 */
export function dayChangeFraction(
  currentValue: number | null,
  dayChange: number | null,
): number | null {
  if (currentValue == null || dayChange == null) return null;
  const prior = currentValue - dayChange;
  if (prior <= 0) return null;
  return dayChange / prior;
}

/**
 * How a composite score renders anywhere it's shown (report page, dashboard).
 * Missing ≠ zero: at 0% coverage there is no data behind the number, so a
 * "0.0" would fabricate a worst-possible score — render "—" instead. One
 * function so every surface tells the same story (the report page and the
 * dashboard once drifted here). Null composite is also "—", never a crash.
 */
export function compositeDisplay(
  composite: number | null | undefined,
  coverage: number | null | undefined,
): string {
  if (composite == null || (coverage ?? 0) === 0) return "—";
  return composite.toFixed(1);
}

/**
 * Percentage change over a price series' endpoints, for the chart caption.
 * Pure + tested because the naive `(last-first)/first` throws off a glitched
 * or suspended first close of 0 ("+Infinity%"/"NaN%" under a real verdict).
 * `pct` is null when the base is non-positive (caption shows "—"); a change
 * that rounds to zero reads "flat" (neutral), never a false green/red +0.0%.
 */
export function priceChangeSummary(
  firstClose: number,
  lastClose: number,
): { pct: number | null; direction: "up" | "down" | "flat" } {
  const pct =
    firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : null;
  const direction =
    pct === null || Math.abs(pct) < 0.05 ? "flat" : pct > 0 ? "up" : "down";
  return { pct, direction };
}

/** Short axis label for a framework criterion key (radar + compact UIs). */
const CRITERION_SHORT_LABELS: Record<string, string> = {
  cost_position: "cost",
  balance_sheet: "balance",
  valuation_vs_history: "value",
  shareholder_returns: "returns",
  yield_attractiveness: "yield",
  coverage_and_sustainability: "cover",
  track_record: "track",
  cut_risk_signals: "cut risk",
  excess_decline: "decline",
  earned_damage: "damage",
  repricing_depth: "repricing",
  business_quality: "biz",
  growth_prospects: "growth",
  risk_profile: "risk",
  governance: "gov",
  offering_terms: "terms",
  positioning: "position",
  resilience: "resilience",
  materiality: "material",
};

export function criterionShortLabel(key: string): string {
  return CRITERION_SHORT_LABELS[key] ?? key.split("_")[0];
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
  /**
   * Macro attribution as persisted — e.g. "macro-amplified · AI capex
   * rotation" or "company-specific". Null on rows written before the macro
   * layer, and on unattributed grades.
   */
  driver: string | null;
  headline: string;
  summary: string;
  sources: { title: string; url: string }[];
}

/** Recognised confidence words in the head (see ReactionNewsGrade). */
const CONFIDENCE_WORDS = new Set(["high", "medium", "low"]);

export function parseNewsEvidence(text: string): ParsedNewsEvidence | null {
  // The head is parsed STRUCTURALLY, not by one growing regex.
  //
  // Rows in the wild carry at least these shapes:
  //   [AXON · damage 15/100 · high]
  //   [FICO · damage 20/100 · high · macro-amplified · AI capex rotation]
  //   [AEM · cost margin 80/100 · medium]
  // The attribution segment is free text (hyphens, slashes, and its OWN "·"
  // before the theme name), so matching it with a character class is how the
  // previous two attempts at this parser broke. Instead: take everything
  // inside the brackets, split on the separator, and identify each part by
  // what it looks like. Anything unrecognised becomes part of the driver
  // rather than failing the parse — because a failed parse dumps the whole
  // row as raw text, unlinked URLs and all.
  const headMatch = /^\[([^\]]+)\]\s*/.exec(text);
  if (!headMatch) return null;

  const segments = headMatch[1].split("·").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return null;

  const ticker = segments[0];
  let gradeLabel: string | null = null;
  let grade: number | null = null;
  let confidence: string | null = null;
  const driverParts: string[] = [];

  for (const seg of segments.slice(1)) {
    const g = /^([a-z][a-z ]*?)\s+(\d{1,3})\/100$/i.exec(seg);
    if (g && gradeLabel === null) {
      gradeLabel = g[1].trim();
      const n = Number(g[2]);
      grade = Number.isFinite(n) ? n : null;
      continue;
    }
    if (confidence === null && CONFIDENCE_WORDS.has(seg.toLowerCase())) {
      confidence = seg.toLowerCase();
      continue;
    }
    driverParts.push(seg);
  }
  // The grade is what makes this an evidence card; without it the caller's
  // plain rendering is the honest fallback.
  if (gradeLabel === null) return null;

  const rest = text.slice(headMatch[0].length);
  const [beforeSources, sourcesBlock] = splitOnce(rest, /\n\s*Sources:\s*\n?/);
  const paragraphs = beforeSources.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const headline = paragraphs[0] ?? "";
  const summary = paragraphs.slice(1).join("\n\n");

  const sources: { title: string; url: string }[] = [];
  if (sourcesBlock) {
    // One per line: "Title — url". Older rows may run them together; also
    // sweep for bare URLs so nothing is lost.
    for (const line of sourcesBlock.split("\n")) {
      // GREEDY title: news headlines contain em-dashes of their own ("Kioxia's
      // miss — what it means — for memory"), and a non-greedy match would cut
      // the title at the first one. The separator is the LAST " — " before the
      // URL.
      const m = /^(.*)\s+—\s+(https?:\/\/\S+)\s*$/.exec(line.trim());
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
    ticker,
    gradeLabel,
    grade,
    confidence,
    driver: driverParts.length > 0 ? driverParts.join(" · ") : null,
    headline,
    summary,
    sources: dedupeSources(sources),
  };
}

/**
 * Drop duplicate sources: same URL, or the same headline syndicated across
 * outlets (the researcher regularly returns one story via two wires). First
 * occurrence wins — order encodes the researcher's own ranking.
 */
function dedupeSources(
  sources: { title: string; url: string }[],
): { title: string; url: string }[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const s of sources) {
    const urlKey = s.url.replace(/\/+$/, "").toLowerCase();
    const titleKey = s.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenUrl.has(urlKey)) continue;
    if (titleKey && seenTitle.has(titleKey)) continue;
    seenUrl.add(urlKey);
    if (titleKey) seenTitle.add(titleKey);
    out.push(s);
  }
  return out;
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
