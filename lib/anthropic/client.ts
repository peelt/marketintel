import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic SDK client. Use for all LLM calls from server-side code only.
 *
 * Model selection is by TIER, not by hardcoded ID. Agents declare a
 * `modelTier` in their metadata ("routine" | "deep"); the concrete model IDs
 * are pinned here — one place — so a model migration is a one-file change.
 *
 *   routine — scoring, summarisation, structured output (Dividend, Energy,
 *             Metals). Currently claude-sonnet-5.
 *   deep    — synthesis-heavy work (IPO league table reasoning, Geopolitical
 *             memo, Reaction verdicts). Currently claude-opus-4-8.
 *
 * Sonnet 5 notes (vs the retired sonnet-4-5 setup):
 *   - adaptive thinking is ON by default and shares max_tokens — routine
 *     calls must set output_config.effort explicitly and leave headroom.
 *   - non-default sampling params (temperature/top_p/top_k) are rejected.
 *   - structured outputs (output_config.format) are GA — use them instead of
 *     parsing JSON out of prose.
 */
let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export type ModelTier = "routine" | "deep";

export const MODELS: Record<ModelTier, string> = {
  routine: process.env.ANTHROPIC_MODEL_ROUTINE ?? "claude-sonnet-5",
  deep: process.env.ANTHROPIC_MODEL_DEEP ?? "claude-opus-4-8",
};

export function modelForTier(tier: ModelTier): string {
  return MODELS[tier];
}
