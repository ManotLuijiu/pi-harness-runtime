/**
 * Token Optimizer Core — budget optimization and cost calculation (RFC-0011)
 */

import type { PromptMessage, TokenBudget, OptimizationResult, CostEstimate } from "./types.js";

const TOKENS_PER_CHAR = 0.25;

const DEFAULT_PRICING: Record<string, { inputPer1M: number; outputPer1M: number; currency: string }> = {
  "gpt-4o":          { inputPer1M: 2.50,  outputPer1M: 10.00, currency: "USD" },
  "gpt-4o-mini":     { inputPer1M: 0.15,  outputPer1M: 0.60,  currency: "USD" },
  "claude-sonnet":   { inputPer1M: 3.00,  outputPer1M: 15.00, currency: "USD" },
  "claude-haiku":    { inputPer1M: 0.25,  outputPer1M: 1.25,  currency: "USD" },
  "gemini-2.5":      { inputPer1M: 0.125, outputPer1M: 0.50,  currency: "USD" },
  "default":         { inputPer1M: 1.00,  outputPer1M: 3.00,  currency: "USD" },
};

export { DEFAULT_PRICING };

/** Estimate token count from string. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/** Estimate tokens in a list of messages. */
export function estimateMessageTokens(messages: PromptMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.content) + 4, 0);
}

/** Build a token budget from components. */
export function buildBudget(
  maxTokens: number,
  systemTokens = 0,
  reservedTokens = 0,
): TokenBudget {
  const availableTokens = Math.max(0, maxTokens - systemTokens - reservedTokens);
  return { maxTokens, systemTokens, promptTokens: 0, reservedTokens, availableTokens };
}

/** Split messages by priority for progressive trimming. */
export function splitByPriority(messages: PromptMessage[]): {
  high: PromptMessage[];
  medium: PromptMessage[];
  low: PromptMessage[];
} {
  const sorted = [...messages].sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));
  const third = Math.ceil(sorted.length / 3);
  return {
    high: sorted.slice(0, third),
    medium: sorted.slice(third, third * 2),
    low: sorted.slice(third * 2),
  };
}

/** Optimize messages to fit within a token budget. */
export function optimizeBudget(
  messages: PromptMessage[],
  budget: TokenBudget,
): OptimizationResult {
  if (budget.availableTokens <= 0) {
    return { kept: [], removed: messages, finalBudget: budget, compressionRatio: 1 };
  }

  const prioritized = splitByPriority(messages);
  const all = [...prioritized.high, ...prioritized.medium, ...prioritized.low];
  const kept: PromptMessage[] = [];
  const removed: PromptMessage[] = [];
  let usedTokens = 0;

  for (const msg of all) {
    const msgTokens = estimateTokens(msg.content) + 4;
    if (usedTokens + msgTokens <= budget.availableTokens) {
      kept.push(msg);
      usedTokens += msgTokens;
    } else {
      removed.push(msg);
    }
  }

  const originalTokens = estimateMessageTokens(messages);
  const compressionRatio = originalTokens > 0 ? (originalTokens - usedTokens) / originalTokens : 0;

  return {
    kept,
    removed,
    finalBudget: { ...budget, promptTokens: usedTokens },
    compressionRatio,
  };
}

/** Calculate cost for a set of messages. */
export function calculateCost(
  messages: PromptMessage[],
  outputTokens: number,
  model = "default",
): CostEstimate {
  const pricing = DEFAULT_PRICING[model] ?? DEFAULT_PRICING["default"];
  const inputTokens = estimateMessageTokens(messages);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return {
    inputTokens,
    outputTokens,
    totalCost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
    currency: pricing.currency,
  };
}

/** Trim a string to a maximum token count. */
export function trimToTokens(text: string, maxTokens: number): string {
  const words = text.split(/\s+/);
  let result = "";
  let tokens = 0;
  for (const word of words) {
    const wordTokens = estimateTokens(word);
    if (tokens + wordTokens <= maxTokens) {
      result += (result ? " " : "") + word;
      tokens += wordTokens;
    } else break;
  }
  return result;
}
