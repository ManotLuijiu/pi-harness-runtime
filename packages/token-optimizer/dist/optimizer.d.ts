/**
 * Token Optimizer Core — budget optimization and cost calculation (RFC-0011)
 */
import type { PromptMessage, TokenBudget, OptimizationResult, CostEstimate } from "./types.js";
declare const DEFAULT_PRICING: Record<string, {
    inputPer1M: number;
    outputPer1M: number;
    currency: string;
}>;
export { DEFAULT_PRICING };
/** Estimate token count from string. */
export declare function estimateTokens(text: string): number;
/** Estimate tokens in a list of messages. */
export declare function estimateMessageTokens(messages: PromptMessage[]): number;
/** Build a token budget from components. */
export declare function buildBudget(maxTokens: number, systemTokens?: number, reservedTokens?: number): TokenBudget;
/** Split messages by priority for progressive trimming. */
export declare function splitByPriority(messages: PromptMessage[]): {
    high: PromptMessage[];
    medium: PromptMessage[];
    low: PromptMessage[];
};
/** Optimize messages to fit within a token budget. */
export declare function optimizeBudget(messages: PromptMessage[], budget: TokenBudget): OptimizationResult;
/** Calculate cost for a set of messages. */
export declare function calculateCost(messages: PromptMessage[], outputTokens: number, model?: string): CostEstimate;
/** Trim a string to a maximum token count. */
export declare function trimToTokens(text: string, maxTokens: number): string;
//# sourceMappingURL=optimizer.d.ts.map