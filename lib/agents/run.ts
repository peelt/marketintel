import type { Agent, AgentRunInput } from "./types";
import { persistReport } from "./persist-report";
import {
  getActiveFramework,
  getFrameworkById,
} from "@/lib/scoring/frameworks-repository";
import { createServiceClient } from "@/lib/supabase/service";
import { getErrorMessage } from "@/lib/errors";

/**
 * Has this agent already filed a SUCCEEDED report today (UTC)? Used to
 * deduplicate a desk whose daily run can be triggered two ways — a data-ready
 * event and a cron backstop — so only the first firing of the day files a
 * report. Pass `trigger` to count only runs fired that way — the reaction
 * dedupe counts ONLY 'scheduled' runs, so a midday on-demand analysis (which
 * screens yesterday's closes) never suppresses tonight's fresh-close edition.
 * Service-role read; Inngest/server contexts only.
 */
export async function hasSucceededReportToday(
  agentName: string,
  options: { trigger?: "scheduled" | "manual" | "event" } = {},
): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const supabase = createServiceClient();
  let query = supabase
    .from("reports")
    .select("id, agent_runs!inner(status, trigger)")
    .eq("agent_name", agentName)
    .eq("agent_runs.status", "succeeded")
    .gte("generated_at", startOfDay.toISOString());
  if (options.trigger) {
    query = query.eq("agent_runs.trigger", options.trigger);
  }
  const { data, error } = await query.limit(1);
  if (error) {
    // On a read error, don't block the run — better a possible duplicate than
    // a silently-skipped daily report.
    console.error(`hasSucceededReportToday(${agentName}): ${getErrorMessage(error)}`);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Run an agent end-to-end and persist the report.
 *
 * Lifecycle (order matters):
 *   1. resolve the framework ONCE and pin its id — the agent scores against
 *      exactly the version the run records, even if the active framework
 *      changes mid-run;
 *   2. create the agent_runs row BEFORE executing, so a failure anywhere —
 *      including inside agent.run() — leaves an auditable failed run;
 *   3. run the agent, persist the report artefacts;
 *   4. mark the run succeeded last.
 *
 * Used by the manual dev endpoint and by the Inngest scheduled functions as
 * they land in PR 4+.
 */
export async function runAgent(
  agent: Agent,
  input: AgentRunInput = {},
  options: {
    trigger?: "scheduled" | "manual" | "event";
    bodyMarkdown?: string;
  } = {},
): Promise<{ reportId: string; runId: string }> {
  const framework = input.frameworkId
    ? await getFrameworkById(input.frameworkId)
    : await getActiveFramework(agent.meta.name);
  if (!framework) {
    throw new Error(
      `runAgent: no ${input.frameworkId ? "matching" : "active"} framework for ${agent.meta.name}. Seed one before running.`,
    );
  }

  const supabase = createServiceClient();
  const { data: run, error: runErr } = await supabase
    .from("agent_runs")
    .insert({
      agent_name: agent.meta.name,
      framework_id: framework.id,
      status: "running",
      trigger: options.trigger ?? "manual",
      input_params: { reason: input.reason ?? null, tickers: input.tickers ?? null },
    })
    .select("id")
    .single<{ id: string }>();
  if (runErr || !run) {
    throw new Error(`runAgent: agent_runs insert failed: ${getErrorMessage(runErr)}`);
  }

  try {
    // Pin the resolved framework so BaseAgent loads the same version by id
    // instead of re-fetching "active" (which could have changed).
    const report = await agent.run({ ...input, frameworkId: framework.id });

    const { reportId } = await persistReport({
      runId: run.id,
      report,
      bodyMarkdown: options.bodyMarkdown ?? report.bodyMarkdown,
    });

    // This write is what makes the report visible (the UI filters on
    // status='succeeded'). If it fails, the report is persisted but stranded
    // invisibly — so fail loudly and let Inngest retry the whole run rather
    // than swallow it. (A retry mints a fresh run + report; the orphan stays
    // hidden behind the status filter.)
    const { error: succeedErr } = await supabase
      .from("agent_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", run.id);
    if (succeedErr) {
      throw new Error(
        `runAgent: report persisted but marking run succeeded failed: ${getErrorMessage(succeedErr)}`,
      );
    }

    // Fan out to the alerting layer (holding alerts email portfolio owners
    // whose names this report flagged). Best-effort by design: a notification
    // failure must never fail a run whose report is already persisted.
    try {
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "report/generated",
        data: { reportId, agentName: agent.meta.name },
      });
    } catch (err) {
      console.warn(
        `runAgent: report/generated event emit failed (alerts skipped): ${getErrorMessage(err)}`,
      );
    }

    return { reportId, runId: run.id };
  } catch (err) {
    await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: getErrorMessage(err),
      })
      .eq("id", run.id);
    throw new Error(
      `agent ${agent.meta.name} run failed: ${getErrorMessage(err)}`,
    );
  }
}
