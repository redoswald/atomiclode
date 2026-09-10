import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5";

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let cached: Anthropic | undefined;

/** Lazily-created client; credentials come from the environment. */
export function anthropic(): Anthropic {
  cached ??= new Anthropic();
  return cached;
}
