import { getAnthropicClient, modelForTier } from "@/lib/anthropic/client";
import { getErrorMessage } from "@/lib/errors";
import type { SignalValue } from "./types";
import {
  buildUserPrompt,
  gradeTextToSignalValue,
  GRADE_SCHEMA,
  SYSTEM_PROMPT,
  type LlmScoringRequest,
} from "./llm-scorer";

/**
 * Anthropic Batch API path for LLM signals (plan §3.5c).
 *
 * The Reaction Analyser grades sentiment/overshoot for tens-to-hundreds of
 * names per run. Sequential Messages calls would blow both the Inngest step
 * budget and the rate limit; the Batch API takes the whole fan-out in one
 * submission at half price.
 *
 * The API is split to fit Inngest's step model — serverless steps can't
 * long-poll, so orchestrators do:
 *
 *   const batchId = await step.run("submit", () => submitLlmBatch(requests));
 *   // step.sleep(...) between checks
 *   const done = await step.run("check", () => isLlmBatchDone(batchId));
 *   const values = await step.run("collect", () => collectLlmBatch(batchId, requests));
 *
 * `scoreBatchWithLlm` composes the three with in-process polling for tests,
 * scripts, and non-serverless contexts.
 *
 * Failure contract matches the single-call scorer: a request whose result is
 * errored/expired/unparseable becomes a NULL signal (weight redistributes),
 * never a zero and never a thrown run.
 */

function customId(index: number): string {
  return `req-${index}`;
}

/** Submit one grade request per LlmScoringRequest. Returns the batch id. */
export async function submitLlmBatch(
  requests: LlmScoringRequest[],
): Promise<string> {
  if (requests.length === 0) {
    throw new Error("submitLlmBatch: empty request list");
  }
  const client = getAnthropicClient();
  const batch = await client.messages.batches.create({
    requests: requests.map((request, i) => ({
      custom_id: customId(i),
      params: {
        model: modelForTier(request.tier ?? "routine"),
        max_tokens: 2_000,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: GRADE_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(request) }],
      },
    })),
  });
  return batch.id;
}

/** True once the batch has finished processing (all results final). */
export async function isLlmBatchDone(batchId: string): Promise<boolean> {
  const client = getAnthropicClient();
  const batch = await client.messages.batches.retrieve(batchId);
  return batch.processing_status === "ended";
}

/**
 * Collect a finished batch back into SignalValues, index-aligned with the
 * submitted requests. Call only after isLlmBatchDone() is true.
 */
export async function collectLlmBatch(
  batchId: string,
  requests: LlmScoringRequest[],
): Promise<SignalValue[]> {
  const client = getAnthropicClient();
  const values: SignalValue[] = requests.map((r) => ({
    raw: null,
    evidence: r.evidence,
  }));

  for await (const entry of await client.messages.batches.results(batchId)) {
    const index = Number(entry.custom_id.replace("req-", ""));
    const request = requests[index];
    if (!request) continue;

    if (entry.result.type !== "succeeded") {
      console.error(
        `collectLlmBatch: ${entry.custom_id} (${request.criterion}) ${entry.result.type}`,
      );
      continue; // stays a null signal
    }
    const message = entry.result.message;
    if (
      message.stop_reason === "refusal" ||
      message.stop_reason === "max_tokens"
    ) {
      console.error(
        `collectLlmBatch: unusable stop_reason=${message.stop_reason} for ${request.criterion}`,
      );
      continue;
    }
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") continue;
    values[index] = gradeTextToSignalValue(request, textBlock.text);
  }

  return values;
}

/**
 * Convenience composition with in-process polling. NOT for serverless route
 * handlers — Inngest functions should use the submit/check/collect pieces
 * with step.sleep between checks.
 */
export async function scoreBatchWithLlm(
  requests: LlmScoringRequest[],
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<SignalValue[]> {
  const pollIntervalMs = options.pollIntervalMs ?? 10_000;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;

  const batchId = await submitLlmBatch(requests);
  const deadline = Date.now() + timeoutMs;

  try {
    while (!(await isLlmBatchDone(batchId))) {
      if (Date.now() > deadline) {
        throw new Error(
          `scoreBatchWithLlm: batch ${batchId} not finished after ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return await collectLlmBatch(batchId, requests);
  } catch (err) {
    throw new Error(`scoreBatchWithLlm: ${getErrorMessage(err)}`);
  }
}
