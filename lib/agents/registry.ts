import type { AgentMeta, AgentName } from "./types";

/**
 * Single source of truth for which agents exist, when they run, and what they
 * do. Concrete implementations get registered against these entries in PRs
 * 4–7. Until then, the registry just exposes metadata so the dashboard and
 * schedule documentation can render correctly.
 *
 * Schedules are UTC. Friday 18:00 UTC = 19:00 BST / 18:00 GMT for the dividend
 * agent — i.e. before the US close on Peel's Friday evening.
 */
const META: Record<AgentName, AgentMeta> = {
  reaction: {
    name: "reaction",
    displayName: "Reaction Analyser",
    description:
      "Screens the broad market for sharp drops and judges overshoot versus earned fundamental damage, with cited evidence per verdict.",
    scope:
      "Watches the S&P 500 and FTSE 350 — about 850 names — for sharp falls: 12% or more over five sessions, or 8% in one. Each qualifying fall is researched in the news and scored on whether the move looks disproportionate to the damage identified, with every source cited. Runs every weekday after the US close, as soon as the evening prices land — a sharp drop is time-sensitive, so this desk is the exception to the weekly cadence.",
    // Weekday backstop after the close; the real driver is the
    // ingest/refresh.completed event (see lib/inngest/functions/reaction.ts),
    // so it usually runs earlier, right when the evening prices land.
    schedule: "0 22 * * 1-5", // weekdays 22:00 UTC (post-close)
    modelTier: "routine", // research runs on the routine tier since the cost-control pass

    status: "live",
  },
  ipo: {
    name: "ipo",
    displayName: "IPO Evaluation",
    description:
      "Weekly league table of fresh S-1/F-1 registrants, each evaluated from its own prospectus on business quality, growth, risk, governance and offering terms.",
    scope:
      "Every company that filed to go public on a US exchange in the last 30 days (S-1 and F-1 registrations with the SEC). Each is graded from its own prospectus only — business quality, growth, risk, governance, offering terms. Companies whose prospectus can't be read, or which have no operating business to grade yet, are listed as excluded rather than guessed at. New edition every Sunday.",
    schedule: "0 18 * * 0", // Sun 18:00 UTC
    modelTier: "routine", // prospectus-grounded structured grading, no synthesis
    status: "live",
  },
  dividend: {
    name: "dividend",
    displayName: "Dividend Intelligence",
    description:
      "Friday report of high-yield names with plain-English sustainability assessment and cut-probability flagging.",
    scope:
      "A curated watchlist of high-yield dividend payers across US and London markets, scored on whether each payout looks sustainable — cash cover, balance-sheet strain, cut risk. A name is on the list for its yield; the score says whether that yield can be trusted. New edition every Friday.",
    schedule: "0 18 * * 5", // Fri 18:00 UTC
    modelTier: "routine",
    status: "live",
  },
  geopolitical: {
    name: "geopolitical",
    displayName: "Geopolitical Scanner",
    description:
      "Weekly macro read of the geopolitical backdrop with confidence levels, over a ranked table of names scored on how they're positioned for it.",
    scope:
      "A curated cross-sector set of companies that geopolitics genuinely moves — defence, semiconductors, energy, critical minerals, agriculture, shipping, China-exposed tech. Each week the desk takes a fresh read of the backdrop, then grades how every name is positioned for it: beneficiary, at risk, insulated or mixed. It grades exposure as it stands — never a bet on an outcome. New edition every Sunday.",
    schedule: "0 20 * * 0", // Sun 20:00 UTC
    modelTier: "routine", // web-researched macro read + structured per-name grading
    status: "live",
  },
  energy: {
    name: "energy",
    displayName: "Energy Beneficiaries",
    description:
      "Upstream, midstream, equipment and energy-intensive industrials ranked on direct exposure and hedging.",
    scope:
      "Upstream, midstream, equipment and energy-intensive industrials, ranked on direct exposure to the energy cycle and how much of it is hedged. (Planned — not yet filing reports.)",
    schedule: "0 10 * * 6", // Sat 10:00 UTC
    modelTier: "routine",
    status: "planned",
  },
  metals: {
    name: "metals",
    displayName: "Precious Metals",
    description:
      "Producers, royalties, majors and juniors scored on AISC-aware cost position — how mining costs sit against the metal price.",
    scope:
      "A curated set of precious-metals producers and royalty companies (ETFs excluded), scored on cost position: what it costs each to mine an ounce against today's metal price, plus balance sheet and mine life. “Well positioned” means low-cost with headroom; “vulnerable” means costs near or above the metal price. New edition every Saturday.",
    schedule: "0 12 * * 6", // Sat 12:00 UTC
    modelTier: "routine",
    status: "live",
  },
};

class AgentRegistry {
  list(): AgentMeta[] {
    return Object.values(META);
  }

  /**
   * Undefined for unknown names — DB rows carry free-text agent_name, so
   * callers must handle a stale/unknown value instead of crashing at render.
   */
  get(name: AgentName): AgentMeta | undefined {
    return META[name];
  }
}

export const agentRegistry = new AgentRegistry();
