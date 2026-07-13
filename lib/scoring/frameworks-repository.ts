import { createServiceClient } from "@/lib/supabase/service";
import type {
  AgentName,
  ScoringCriterion,
  ScoringFramework,
} from "@/lib/agents/types";
import { getErrorMessage } from "@/lib/errors";

/**
 * Read/write versioned scoring frameworks.
 *
 * One agent has many framework versions. Exactly one is `is_active` per agent.
 * Reports are persisted with their framework_id so historical reports stay
 * comparable to the rules they were scored against, even after the active
 * version changes.
 */

interface FrameworkRow {
  id: string;
  agent_name: string;
  version: number;
  criteria: { criteria: ScoringCriterion[] };
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export async function getActiveFramework(
  agentName: AgentName,
): Promise<ScoringFramework | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("scoring_frameworks")
    .select("*")
    .eq("agent_name", agentName)
    .eq("is_active", true)
    .maybeSingle<FrameworkRow>();
  if (error) throw new Error(`getActiveFramework: ${getErrorMessage(error)}`);
  if (!data) return null;
  return rowToFramework(data);
}

export async function getFrameworkById(
  id: string,
): Promise<ScoringFramework | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("scoring_frameworks")
    .select("*")
    .eq("id", id)
    .maybeSingle<FrameworkRow>();
  if (error) throw new Error(`getFrameworkById: ${getErrorMessage(error)}`);
  if (!data) return null;
  return rowToFramework(data);
}

export async function listFrameworksForAgent(
  agentName: AgentName,
): Promise<ScoringFramework[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("scoring_frameworks")
    .select("*")
    .eq("agent_name", agentName)
    .order("version", { ascending: false })
    .returns<FrameworkRow[]>();
  if (error) throw new Error(`listFrameworksForAgent: ${getErrorMessage(error)}`);
  return (data ?? []).map(rowToFramework);
}

/**
 * Save a new framework version for an agent. Existing versions stay; only the
 * new row is marked active and the previous active row's flag is cleared.
 */
export async function saveNewFrameworkVersion(input: {
  agentName: AgentName;
  criteria: ScoringCriterion[];
  notes?: string;
  setActive?: boolean;
}): Promise<ScoringFramework> {
  const supabase = createServiceClient();
  validateCriteria(input.criteria);

  const { data: existing, error: maxErr } = await supabase
    .from("scoring_frameworks")
    .select("version")
    .eq("agent_name", input.agentName)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();
  if (maxErr) throw new Error(`saveNewFrameworkVersion: ${getErrorMessage(maxErr)}`);
  const nextVersion = (existing?.version ?? 0) + 1;
  const setActive = input.setActive ?? true;

  if (setActive) {
    const { error: clearErr } = await supabase
      .from("scoring_frameworks")
      .update({ is_active: false })
      .eq("agent_name", input.agentName)
      .eq("is_active", true);
    if (clearErr) throw new Error(`saveNewFrameworkVersion clear-active: ${getErrorMessage(clearErr)}`);
  }

  const { data, error } = await supabase
    .from("scoring_frameworks")
    .insert({
      agent_name: input.agentName,
      version: nextVersion,
      criteria: { criteria: input.criteria },
      notes: input.notes ?? null,
      is_active: setActive,
    })
    .select("*")
    .single<FrameworkRow>();
  if (error || !data)
    throw new Error(`saveNewFrameworkVersion insert: ${getErrorMessage(error)}`);
  return rowToFramework(data);
}

function rowToFramework(row: FrameworkRow): ScoringFramework {
  return {
    id: row.id,
    agentName: row.agent_name as AgentName,
    version: row.version,
    criteria: row.criteria.criteria,
  };
}

function validateCriteria(criteria: ScoringCriterion[]) {
  if (criteria.length === 0) {
    throw new Error("framework must declare at least one criterion");
  }
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(totalWeight - 1) > 0.001) {
    throw new Error(
      `criterion weights must sum to 1, got ${totalWeight.toFixed(3)}`,
    );
  }
  for (const c of criteria) {
    if (!c.subSignals.length) {
      throw new Error(`criterion '${c.key}' has no sub-signals`);
    }
    const subWeight = c.subSignals.reduce((s, x) => s + x.weight, 0);
    if (Math.abs(subWeight - 1) > 0.001) {
      throw new Error(
        `sub-signal weights for '${c.key}' must sum to 1, got ${subWeight.toFixed(3)}`,
      );
    }
  }
}
