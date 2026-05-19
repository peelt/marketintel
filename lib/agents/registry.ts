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
  ipo: {
    name: "ipo",
    displayName: "IPO Evaluation",
    description:
      "Weekly league table of upcoming IPOs scored on valuation, growth, management, market timing and risk.",
    schedule: "0 18 * * 0", // Sun 18:00 UTC
    defaultModel: "claude-opus-4-7",
  },
  dividend: {
    name: "dividend",
    displayName: "Dividend Intelligence",
    description:
      "Friday report of high-yield names with plain-English sustainability assessment and cut-probability flagging.",
    schedule: "0 18 * * 5", // Fri 18:00 UTC
    defaultModel: "claude-sonnet-4-5",
  },
  geopolitical: {
    name: "geopolitical",
    displayName: "Geopolitical Scanner",
    description:
      "Memo on macro and geopolitical shifts with source-weighted signals and explicit confidence levels.",
    schedule: "0 20 * * 0", // Sun 20:00 UTC
    defaultModel: "claude-opus-4-7",
  },
  energy: {
    name: "energy",
    displayName: "Energy Beneficiaries",
    description:
      "Upstream, midstream, equipment and energy-intensive industrials ranked on direct exposure and hedging.",
    schedule: "0 10 * * 6", // Sat 10:00 UTC
    defaultModel: "claude-sonnet-4-5",
  },
  metals: {
    name: "metals",
    displayName: "Precious Metals",
    description:
      "Buy/hold/avoid across ETFs, royalties, majors and juniors with AISC-aware valuation logic.",
    schedule: "0 12 * * 6", // Sat 12:00 UTC
    defaultModel: "claude-sonnet-4-5",
  },
};

class AgentRegistry {
  list(): AgentMeta[] {
    return Object.values(META);
  }

  get(name: AgentName): AgentMeta {
    return META[name];
  }
}

export const agentRegistry = new AgentRegistry();
