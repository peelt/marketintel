import { z } from "zod";
import metalsRaw from "./metals.json";
import energyRaw from "./energy.json";
import dividendRaw from "./dividend.json";
import geopoliticalRaw from "./geopolitical.json";

/**
 * Curated starter universes. Each agent draws from one or more.
 *
 * These lists are deliberately small — better signal in a tight universe than
 * noise across thousands of tickers. Expand only when you have a specific
 * reason to; universe creep dilutes scoring quality.
 *
 * Annual review cadence — bump `_meta.last_reviewed` in each JSON when you
 * touch it so we don't drift on delistings and mergers (e.g. PXD acquired by
 * XOM; EVR delisted; etc.).
 */

const SeedSecurityZ = z.object({
  ticker: z.string().min(1),
  exchange: z.string().min(1),
  name: z.string().min(1),
  country: z.string().optional(),
  currency: z.string().min(1),
  asset_class: z
    .enum(["equity", "etf", "royalty", "adr", "reit", "trust"])
    .optional()
    .default("equity"),
  sector: z.string().optional(),
  sub_sector: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

const UniverseFileZ = z.object({
  _meta: z.object({
    version: z.number(),
    last_reviewed: z.string(),
    notes: z.string().optional(),
  }),
  securities: z.array(SeedSecurityZ),
});

export type SeedSecurity = z.infer<typeof SeedSecurityZ>;
export type UniverseFile = z.infer<typeof UniverseFileZ>;

export const metalsUniverse: UniverseFile = UniverseFileZ.parse(metalsRaw);
export const energyUniverse: UniverseFile = UniverseFileZ.parse(energyRaw);
export const dividendUniverse: UniverseFile = UniverseFileZ.parse(dividendRaw);
export const geopoliticalUniverse: UniverseFile =
  UniverseFileZ.parse(geopoliticalRaw);

export function allSeedSecurities(): SeedSecurity[] {
  // Dedup on (ticker, exchange) — RIO appears in both metals and dividend etc.
  const seen = new Set<string>();
  const out: SeedSecurity[] = [];
  for (const u of [
    metalsUniverse,
    energyUniverse,
    dividendUniverse,
    geopoliticalUniverse,
  ]) {
    for (const s of u.securities) {
      const key = `${s.ticker}::${s.exchange}`;
      if (seen.has(key)) {
        // Merge tags from later occurrence into earlier one
        const existing = out.find(
          (x) => x.ticker === s.ticker && x.exchange === s.exchange,
        );
        if (existing) {
          const merged = new Set([...(existing.tags ?? []), ...(s.tags ?? [])]);
          existing.tags = Array.from(merged);
        }
        continue;
      }
      seen.add(key);
      out.push({ ...s });
    }
  }
  return out;
}
