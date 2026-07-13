import type { Agent, AgentRunInput } from "./types";
import { persistReport } from "./persist-report";
import { getActiveFramework } from "@/lib/scoring/frameworks-repository";
import { getErrorMessage } from "@/lib/errors";

/**
 * Run an agent end-to-end and persist the report.
 *
 * Thin wrapper around agent.run() + persistReport(). Used by the manual
 * /api/dev/run endpoint here in PR 3 and by the Inngest scheduled functions
 * that land in PR 4+ once the first concrete agent exists.
 *
 * Composes the markdown body from the summary + a ranked-table appendix.
 * Individual agents can override composeReport() to produce richer bodies.
 */
export async function runAgent(
  agent: Agent,
  input: AgentRunInput = {},
  options: {
    trigger?: "scheduled" | "manual" | "event";
    bodyMarkdown?: string;
  } = {},
): Promise<{ reportId: string; runId: string }> {
  const framework =
    input.frameworkId
      ? // Trust the agent to load this one — base does that itself.
        null
      : await getActiveFramework(agent.meta.name);
  if (!framework && !input.frameworkId) {
    throw new Error(
      `runAgent: no active framework for ${agent.meta.name}. Seed one before running.`,
    );
  }

  let report;
  try {
    report = await agent.run(input);
  } catch (err) {
    throw new Error(
      `agent ${agent.meta.name} run failed: ${getErrorMessage(err)}`,
    );
  }

  const frameworkId = framework?.id ?? input.frameworkId!;
  const bodyMarkdown = options.bodyMarkdown ?? report.bodyMarkdown;

  return persistReport({
    agentName: agent.meta.name,
    frameworkId,
    report,
    bodyMarkdown,
    trigger: options.trigger ?? "manual",
    inputParams: { reason: input.reason ?? null },
  });
}
