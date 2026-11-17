/**
 * The edition index: every filed report of a desk, arranged as a reader
 * thinks of it — ONE daily edition per date, stepped through in order and
 * laid out on a calendar.
 *
 * Pure and client-safe (no I/O, no server imports): the reports navigator is
 * a client component and builds its calendar from this module. The read that
 * feeds it lives in `edition-index.ts`.
 *
 * Why this exists rather than "the newest report row": report rows are not
 * all editions. An on-demand per-ticker run files a report too, and so does a
 * manual ops run or a same-day re-run — live data already has four dates
 * holding 2–3 rows. Treating the newest row as "the latest edition" let a
 * mid-morning single-name analysis take over the reports page.
 */

/** One `reports` row joined to its run, as the index read returns it. */
export interface EditionRowInput {
  id: string;
  agent_name: string;
  /** timestamptz, any offset. The edition's date is its UTC day. */
  generated_at: string;
  summary_markdown: string;
  /** agent_runs.trigger — 'scheduled' | 'manual' | 'event'. */
  trigger: string | null;
  /** agent_runs.input_params — jsonb, shape varies by era (see onDemandTickers). */
  input_params: unknown;
}

/** A daily edition, compact enough to ship to the client by the hundred. */
export interface Edition {
  id: string;
  /** YYYY-MM-DD, the UTC day it was filed (the name every surface uses). */
  date: string;
  /** Names that cleared the drop screen; null when the summary doesn't say. */
  cleared: number | null;
  /** Moves flagged as overshoot; null when the summary doesn't say. */
  overshoots: number | null;
  /** The flagged names the summary lists — the TOP THREE only, not all. */
  flagged: string[];
}

/** A report that is not its date's daily edition. */
export interface EditionExtra {
  id: string;
  date: string;
  /** "HH:MM" UTC, to tell two same-day extras apart. */
  time: string;
  /** on_demand: a per-ticker run. superseded: an earlier/other run that day. */
  kind: "on_demand" | "superseded";
  /** The requested tickers (on-demand only). */
  tickers: string[];
}

export interface EditionIndex {
  /** Oldest → newest, exactly one per date. */
  editions: Edition[];
  /** Newest first. */
  extras: EditionExtra[];
}

export const EMPTY_INDEX: EditionIndex = { editions: [], extras: [] };

// ---------------------------------------------------------------------------
// Summary parsing
// ---------------------------------------------------------------------------

/**
 * The counts a filed summary states. The summary is composed by OUR code
 * (ReactionAgent.composeReport / BaseAgent.emptySummary), not by a model, so
 * its shapes are a closed set — but filed editions are immutable, so every
 * shape ever shipped has to keep parsing:
 *
 *   "853 names screened; 8 cleared the drop threshold. Framework flags 3
 *    moves as overshoot: **AXON**, **KNOS**, **GPN**. …"
 *   "… 52 cleared the drop threshold (top 20 by severity analysed, 32
 *    deferred). Framework flags 12 move(s) as overshoot: …"   (old plural)
 *   "… No screened move graded as overshoot — declines look earned or worse."
 *   "_No candidates passed the Reaction Analyser screen this run._"
 *   "**BATS** was requested on demand: … does not clear the drop screen …"
 *
 * Anything else is null, never a guessed 0 (missing ≠ zero): a calendar day
 * with no dots must mean "no overshoot", not "couldn't read it".
 */
export function parseEditionSummary(summary: string): {
  cleared: number | null;
  overshoots: number | null;
  flagged: string[];
} {
  // The base agent's stub for an empty screen: a real, known zero.
  if (/^_No candidates passed the .+ screen this run\._$/.test(summary.trim())) {
    return { cleared: 0, overshoots: 0, flagged: [] };
  }

  const clearedMatch = /\b[\d,]+ names screened; ([\d,]+) cleared the drop threshold/.exec(
    summary,
  );
  const cleared = clearedMatch ? toCount(clearedMatch[1]) : null;

  // The flagged names are read as consecutive **bold** tokens, NOT as "text
  // up to the next full stop" — tickers contain dots (BT.A, RDS.B).
  const flags = /Framework flags (\d+) move(?:\(s\)|s)? as overshoot:((?:\s*\*\*[^*]+\*\*,?)+)/.exec(
    summary,
  );
  if (flags) {
    const flagged = [...flags[2].matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
    return { cleared, overshoots: toCount(flags[1]), flagged };
  }
  if (
    /No screened move graded as overshoot/.test(summary) ||
    /No qualifying drops this run\./.test(summary)
  ) {
    return { cleared, overshoots: 0, flagged: [] };
  }
  return { cleared, overshoots: null, flagged: [] };
}

function toCount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The tickers an on-demand run was asked for, or null for a full-universe
 * run. `input_params` has three live shapes: `{tickers: ["BATS"]}`,
 * `{tickers: null}`, and — on the earliest rows — no `tickers` key at all.
 */
export function onDemandTickers(inputParams: unknown): string[] | null {
  if (!inputParams || typeof inputParams !== "object") return null;
  const tickers = (inputParams as { tickers?: unknown }).tickers;
  if (!Array.isArray(tickers)) return null;
  const clean = tickers.filter((t): t is string => typeof t === "string" && t.trim() !== "");
  return clean.length > 0 ? clean : null;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/** The UTC day and "HH:MM" of a timestamptz, whatever offset it arrived in. */
function utcParts(iso: string): { date: string; time: string } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const utc = new Date(t).toISOString();
  return { date: utc.slice(0, 10), time: utc.slice(11, 16) };
}

/**
 * Arrange ONE desk's report rows as editions + extras.
 *
 * A date's edition is its scheduled full-universe run; failing that, its
 * latest full-universe run. "Latest" alone is wrong: since the retime, a
 * manual run later in the day grades prices the NEXT morning's edition owns,
 * and before it a scheduled evening run superseded a morning ops run (24 Jul:
 * manual 08:37 with 4 cleared, scheduled 21:39 with 11). Among several
 * scheduled runs on one date (22 Sep) the later one stands.
 */
export function buildEditionIndex(rows: EditionRowInput[]): EditionIndex {
  interface Dated {
    row: EditionRowInput;
    date: string;
    time: string;
    at: number;
  }
  const byDate = new Map<string, Dated[]>();
  const extras: (EditionExtra & { at: number })[] = [];

  for (const row of rows) {
    const parts = utcParts(row.generated_at);
    if (!parts) continue;
    const dated: Dated = { row, ...parts, at: Date.parse(row.generated_at) };
    const tickers = onDemandTickers(row.input_params);
    if (tickers) {
      extras.push({
        id: row.id,
        date: dated.date,
        time: dated.time,
        kind: "on_demand",
        tickers,
        at: dated.at,
      });
      continue;
    }
    const list = byDate.get(dated.date) ?? [];
    list.push(dated);
    byDate.set(dated.date, list);
  }

  const editions: Edition[] = [];
  for (const [date, list] of byDate) {
    const best = [...list].sort((a, b) => {
      const sa = a.row.trigger === "scheduled" ? 1 : 0;
      const sb = b.row.trigger === "scheduled" ? 1 : 0;
      return sb - sa || b.at - a.at;
    })[0];
    editions.push({ id: best.row.id, date, ...parseEditionSummary(best.row.summary_markdown) });
    for (const other of list) {
      if (other === best) continue;
      extras.push({
        id: other.row.id,
        date,
        time: other.time,
        kind: "superseded",
        tickers: [],
        at: other.at,
      });
    }
  }

  editions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  extras.sort((a, b) => b.at - a.at);
  return {
    editions,
    extras: extras.map((e) => ({
      id: e.id,
      date: e.date,
      time: e.time,
      kind: e.kind,
      tickers: e.tickers,
    })),
  };
}

/** Group rows by desk and index each. */
export function buildEditionIndexes(rows: EditionRowInput[]): Record<string, EditionIndex> {
  const byDesk = new Map<string, EditionRowInput[]>();
  for (const r of rows) {
    const list = byDesk.get(r.agent_name) ?? [];
    list.push(r);
    byDesk.set(r.agent_name, list);
  }
  return Object.fromEntries([...byDesk].map(([desk, list]) => [desk, buildEditionIndex(list)]));
}

export function latestEdition(index: EditionIndex | undefined): Edition | null {
  return index && index.editions.length > 0 ? index.editions[index.editions.length - 1] : null;
}

export type EditionLocation =
  | {
      kind: "edition";
      edition: Edition;
      prev: Edition | null;
      next: Edition | null;
      latest: Edition;
      isLatest: boolean;
    }
  | {
      kind: "extra";
      extra: EditionExtra;
      /** The daily edition filed on the extra's own date, if there is one. */
      dayEdition: Edition | null;
      /** The surrounding daily editions: on/before its date, and after. */
      prev: Edition | null;
      next: Edition | null;
      latest: Edition | null;
    };

/**
 * Where a report sits in its desk's run of editions. `reportId` null means
 * "the reports page itself" — the latest edition. A report the index doesn't
 * hold (older than the read's ceiling, another desk) is null: the navigator
 * goes neutral rather than guess a position.
 */
export function locateEdition(
  index: EditionIndex,
  reportId: string | null,
): EditionLocation | null {
  const { editions, extras } = index;
  const latest = latestEdition(index);

  if (reportId === null) {
    if (!latest) return null;
    return {
      kind: "edition",
      edition: latest,
      prev: editions.length > 1 ? editions[editions.length - 2] : null,
      next: null,
      latest,
      isLatest: true,
    };
  }

  const i = editions.findIndex((e) => e.id === reportId);
  if (i >= 0 && latest) {
    return {
      kind: "edition",
      edition: editions[i],
      prev: i > 0 ? editions[i - 1] : null,
      next: i < editions.length - 1 ? editions[i + 1] : null,
      latest,
      isLatest: i === editions.length - 1,
    };
  }

  const extra = extras.find((e) => e.id === reportId);
  if (!extra) return null;
  let prev: Edition | null = null;
  let next: Edition | null = null;
  for (const e of editions) {
    if (e.date <= extra.date) prev = e;
    else {
      next = e;
      break;
    }
  }
  return {
    kind: "extra",
    extra,
    dayEdition: prev && prev.date === extra.date ? prev : null,
    prev,
    next,
    latest,
  };
}

/**
 * Which desk's index holds a report. Falls back to `primaryDesk` for the
 * reports page itself (no id) and for an id no index holds.
 */
export function deskOfReport(
  indexes: Record<string, EditionIndex>,
  reportId: string | null,
  primaryDesk: string | null,
): string | null {
  if (reportId) {
    for (const [desk, index] of Object.entries(indexes)) {
      if (
        index.editions.some((e) => e.id === reportId) ||
        index.extras.some((e) => e.id === reportId)
      ) {
        return desk;
      }
    }
  }
  return primaryDesk;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/**
 * A month as Monday-first weeks of YYYY-MM-DD cells; null pads the days of
 * neighbouring months. Only as many rows as the month needs (4–6). Built on
 * Date.UTC arithmetic alone — no locale, no local timezone — so the server
 * and the reader's browser always draw the same grid.
 */
export function calendarWeeks(year: number, month: number): (string | null)[][] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // getUTCDay: 0 = Sunday. Monday-first offset of the 1st.
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  const mm = String(month).padStart(2, "0");
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${mm}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "2026-11" of a date, and stepping it by whole months. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Overshoot dots on a calendar day: 0–3. The bins are the terciles of every
 * edition filed to Nov 2026 (1–3: 27 editions, 4–8: 28, 9+: 23). The obvious
 * 1–2 / 3–5 / 6+ put almost half of all editions in the top bin, where a
 * 6-flag day and a 16-flag day looked the same.
 */
export const OVERSHOOT_BINS = { one: 1, two: 4, three: 9 } as const;

export function overshootLevel(overshoots: number | null): 0 | 1 | 2 | 3 {
  if (overshoots == null || overshoots < OVERSHOOT_BINS.one) return 0;
  if (overshoots < OVERSHOOT_BINS.two) return 1;
  if (overshoots < OVERSHOOT_BINS.three) return 2;
  return 3;
}

/**
 * What an edition found, in a phrase — the calendar's preview line and each
 * day link's accessible name share it, so a screen-reader user hears exactly
 * what the dots and the hover show. `flagged` is the summary's top three, so
 * a longer list says how many more there are rather than implying it's all.
 */
export function editionFindings(e: Edition): string {
  if (e.cleared === null && e.overshoots === null) return "edition filed";
  if (e.cleared === 0) return "nothing cleared the screen";
  const parts: string[] = [];
  if (e.cleared !== null) parts.push(`${e.cleared} cleared the screen`);
  if (e.overshoots === 0) parts.push("no overshoot flagged");
  else if (e.overshoots !== null) {
    const more = e.overshoots - e.flagged.length;
    const names =
      e.flagged.length > 0
        ? `: ${e.flagged.join(", ")}${more > 0 ? ` +${more} more` : ""}`
        : "";
    parts.push(`${e.overshoots} overshoot${e.overshoots === 1 ? "" : "s"}${names}`);
  }
  return parts.join(" · ");
}
