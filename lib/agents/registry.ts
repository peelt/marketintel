import type { AgentMeta, AgentName } from "./types";

/**
 * Single source of truth for which agents exist, when they run, and what they
 * do.
 *
 * 2026-07 scope reduction (evidence-grounded; see CLAUDE.md "Settled product
 * decisions"): the product is the Reaction Analyser. The weekly specialist
 * desks are RETIRED — dividend, metals and ipo permanently (their frameworks
 * depended on fundamentals columns the current source can never populate, or
 * — ipo — the desk graded only 4 of 25 prospectuses and has no tie to
 * holdings by design), and geopolitical is retired AS A DESK but partly
 * rebuilt: its macro read now runs inside Reaction (lib/agents/reaction/
 * macro.ts) as the "why did it drop" backdrop, which was the only part
 * intrinsic to Reaction's question. Its per-name exposure grading — the half
 * that made it a second product — stays retired. Retired desks keep their
 * metadata and code so historical rows stay renderable in admin/debug
 * contexts and a revival is a status flip, but their crons are unregistered
 * and no product surface shows them.
 *
 * Schedules are UTC.
 */
const META: Record<AgentName, AgentMeta> = {
  reaction: {
    name: "reaction",
    displayName: "Reaction Analyser",
    description:
      "Overnight, on the session that just closed: screens the broad market for sharp drops and judges overshoot versus earned fundamental damage, with cited evidence per verdict.",
    scope:
      "Watches the S&P 500 and FTSE 350 — about 850 names — for sharp falls: 12% or more over five sessions, or 8% in one. Each qualifying fall is researched in the news and scored on whether the move looks disproportionate to the damage identified, with every source cited. Runs overnight after each weekday close, once the exchanges have finalised their closing prices — so each edition grades the session that just ended and is waiting before London opens.",
    cadence: "daily · overnight",
    // Backstop only — the real driver is the ingest/refresh.completed event
    // from the 00:30 UTC price pass (see lib/inngest/functions/reaction.ts).
    // It sits AFTER that pass deliberately: the 21:30 evening fetch reliably
    // returns only the previous session's closes, so a 22:00 backstop would
    // file exactly the T-1 edition the retime removed.
    schedule: "0 1 * * 2-6", // 01:00 UTC Tue-Sat, after the 00:30 price pass
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
    cadence: "weekly · Sun",
    schedule: "0 18 * * 0", // Sun 18:00 UTC
    modelTier: "routine", // prospectus-grounded structured grading, no synthesis
    // Retired 2026-07: last edition graded 4/25 prospectuses (the rest filed
    // insufficient_data at 0% coverage), and IPO issuers are excluded from
    // holdings by design, so the desk never fed the intel-lens moat.
    status: "retired",
  },
  dividend: {
    name: "dividend",
    displayName: "Dividend Intelligence",
    description:
      "Friday report of high-yield names with plain-English sustainability assessment and cut-probability flagging.",
    scope:
      "A curated watchlist of high-yield dividend payers across US and London markets, scored on whether each payout looks sustainable — cash cover, balance-sheet strain, cut risk. A name is on the list for its yield; the score says whether that yield can be trusted. New edition every Friday.",
    cadence: "weekly · Fri",
    schedule: "0 18 * * 5", // Fri 18:00 UTC
    modelTier: "routine",
    // Retired 2026-07. Re-entry condition: a fundamentals source that can
    // complete the sustainability criterion (payout, FCF cover, debt/EBITDA,
    // OCF trend) for a defined universe — the audited editions filed with all
    // three ratios null for every name (64% coverage US, 33% LSE), which is
    // strictly weaker than established dividend-safety services.
    status: "retired",
  },
  geopolitical: {
    name: "geopolitical",
    displayName: "Geopolitical Scanner",
    description:
      "Weekly macro read of the geopolitical backdrop with confidence levels, over a ranked table of names scored on how they're positioned for it.",
    scope:
      "A curated cross-sector set of companies that geopolitics genuinely moves — defence, semiconductors, energy, critical minerals, agriculture, shipping, China-exposed tech. Each week the desk takes a fresh read of the backdrop, then grades how every name is positioned for it: beneficiary, at risk, insulated or mixed. It grades exposure as it stands — never a bet on an outcome. New edition every Sunday.",
    cadence: "weekly · Sun",
    schedule: "0 20 * * 0", // Sun 20:00 UTC
    modelTier: "routine", // web-researched macro read + structured per-name grading
    // Retired 2026-07 as a DESK (code and engine kept intact). The only desk
    // that filed at 100% coverage — but its curated universe barely intersects
    // Reaction's screen (5/39 names, zero co-filings), so as built it was a
    // second product, not context for the hero. Its macro read has since been
    // rebuilt inside Reaction (lib/agents/reaction/macro.ts) as the backdrop
    // each drop is attributed against; the per-name exposure grading here is
    // what stays retired. Do not re-register this schedule.
    status: "retired",
  },
  energy: {
    name: "energy",
    displayName: "Energy Beneficiaries",
    description:
      "Upstream, midstream, equipment and energy-intensive industrials ranked on direct exposure and hedging.",
    scope:
      "Upstream, midstream, equipment and energy-intensive industrials, ranked on direct exposure to the energy cycle and how much of it is hedged. (Planned — not yet filing reports.)",
    cadence: "weekly · Sat",
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
    cadence: "weekly · Sat",
    schedule: "0 12 * * 6", // Sat 12:00 UTC
    modelTier: "routine",
    // Retired 2026-07. The AISC research is genuinely differentiated, but the
    // desk shares nothing with Reaction (2/23 names in the screen, zero
    // co-filings ever) — a second product line, not a supporting feature; its
    // balance-sheet criterion also read fundamentals columns the source never
    // populates.
    status: "retired",
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
