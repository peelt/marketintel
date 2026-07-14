import { httpText } from "./http";
import { SchemaChangedError } from "./errors";

/**
 * Broad-market index constituents (PR 5): S&P 500 + FTSE 350, parsed from
 * Wikipedia's constituent tables. Used ONLY to build our internal screening
 * universe — constituent lists are facts about index membership, and nothing
 * here is redistributed (I3).
 *
 * Wikipedia is the pragmatic free source: the tables carry `id="constituents"`
 * and have been shape-stable for years. Parsing is defensive anyway: a count
 * far outside the expected band throws SchemaChangedError instead of quietly
 * seeding a broken universe.
 */

export interface IndexConstituent {
  ticker: string;
  exchange: string; // "US" (NYSE/NASDAQ indistinct in source) or "LSE"
  name: string;
  index: "sp500" | "ftse100" | "ftse250";
}

const SOURCES = {
  sp500: {
    url: "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
    exchange: "US",
    // Column headers as they appear; matched case-insensitively.
    tickerHeader: "symbol",
    nameHeader: "security",
    expected: [480, 520] as const,
  },
  ftse100: {
    url: "https://en.wikipedia.org/wiki/FTSE_100_Index",
    exchange: "LSE",
    tickerHeader: "ticker",
    nameHeader: "company",
    expected: [90, 110] as const,
  },
  ftse250: {
    url: "https://en.wikipedia.org/wiki/FTSE_250_Index",
    exchange: "LSE",
    tickerHeader: "ticker",
    nameHeader: "company",
    expected: [230, 270] as const,
  },
} as const;

type IndexKey = keyof typeof SOURCES;

export async function fetchIndexConstituents(
  index: IndexKey,
): Promise<IndexConstituent[]> {
  const source = SOURCES[index];
  const html = await httpText(source.url, {
    userAgent: "investorlogical/0.1 (universe seeding)",
    hostThrottleMs: 500,
    headers: { Accept: "text/html" },
  });
  const rows = parseConstituentsTable(html, {
    tickerHeader: source.tickerHeader,
    nameHeader: source.nameHeader,
  });

  const [min, max] = source.expected;
  if (rows.length < min || rows.length > max) {
    throw new SchemaChangedError(
      "wikipedia_constituents",
      `${index} constituents table parsed to ${rows.length} rows (expected ${min}–${max}) — page layout likely changed`,
    );
  }

  return rows.map((r) => ({
    ticker: r.ticker,
    exchange: source.exchange,
    name: r.name,
    index,
  }));
}

/** All three lists, deduped on (ticker, exchange) — FTSE 350 = 100 + 250. */
export async function fetchBroadMarketConstituents(): Promise<IndexConstituent[]> {
  const [sp500, ftse100, ftse250] = [
    await fetchIndexConstituents("sp500"),
    await fetchIndexConstituents("ftse100"),
    await fetchIndexConstituents("ftse250"),
  ];
  const seen = new Set<string>();
  const out: IndexConstituent[] = [];
  for (const c of [...sp500, ...ftse100, ...ftse250]) {
    const key = `${c.ticker}::${c.exchange}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ---------- HTML table parsing (no DOM dependency) ----------

/**
 * Exported for tests. Finds the table with id="constituents", reads the
 * header row to locate the ticker and name columns, and extracts one entry
 * per body row.
 */
export function parseConstituentsTable(
  html: string,
  columns: { tickerHeader: string; nameHeader: string },
): { ticker: string; name: string }[] {
  const tableMatch = /<table[^>]*id="constituents"[\s\S]*?<\/table>/i.exec(html);
  if (!tableMatch) return [];
  const table = tableMatch[0];

  const rowMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const headerRow = rowMatches[0];
  if (!headerRow || rowMatches.length < 2) return [];

  const headerCells = cellsOf(headerRow, /<th[^>]*>([\s\S]*?)<\/th>/gi);
  const tickerIdx = headerCells.findIndex((h) =>
    h.toLowerCase().includes(columns.tickerHeader),
  );
  const nameIdx = headerCells.findIndex((h) =>
    h.toLowerCase().includes(columns.nameHeader),
  );
  if (tickerIdx < 0 || nameIdx < 0) return [];

  const out: { ticker: string; name: string }[] = [];
  for (const row of rowMatches.slice(1)) {
    const cells = cellsOf(row, /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
    const ticker = cells[tickerIdx]?.trim();
    const name = cells[nameIdx]?.trim();
    if (!ticker || !name) continue;
    // Tickers are short codes; anything longer is a parsing artefact.
    if (ticker.length > 8) continue;
    out.push({ ticker: ticker.toUpperCase(), name });
  }
  return out;
}

function cellsOf(row: string, cellRegex: RegExp): string[] {
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = cellRegex.exec(row)) !== null) {
    cells.push(stripHtml(m[1]));
  }
  return cells;
}

function stripHtml(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
