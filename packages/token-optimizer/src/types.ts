/**
 * Token Optimizer Types (RFC-0011)
 */

export interface PromptMessage {
	role: "system" | "user" | "assistant";
	content: string;
	priority?: number;
}

export interface TokenBudget {
	maxTokens: number;
	systemTokens: number;
	promptTokens: number;
	reservedTokens: number;
	availableTokens: number;
}

export interface OptimizationResult {
	kept: PromptMessage[];
	removed: PromptMessage[];
	finalBudget: TokenBudget;
	compressionRatio: number;
}

export interface CostEstimate {
	inputTokens: number;
	outputTokens: number;
	totalCost: number;
	currency: string;
}

export type ModelId =
	| "gpt-4o"
	| "gpt-4o-mini"
	| "claude-sonnet"
	| "claude-haiku"
	| "gemini-2.5"
	| "default";

export interface ModelPricing {
	[model: string]: {
		inputPer1M: number;
		outputPer1M: number;
		currency: string;
	};
}
