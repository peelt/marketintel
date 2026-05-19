import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic SDK client. Use for all LLM calls from server-side code only.
 *
 * Model choice:
 *   - claude-sonnet-4-5 — routine scoring, summarisation, structured output
 *   - claude-opus-4-7   — deeper synthesis (IPO league table reasoning,
 *                         geopolitical memo)
 *
 * Per-agent defaults live in `lib/agents/registry.ts`. Override per call if a
 * step within an agent needs the cheaper or deeper model.
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

export const MODELS = {
  default: process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-5",
  deep: process.env.ANTHROPIC_MODEL_DEEP ?? "claude-opus-4-7",
} as const;
