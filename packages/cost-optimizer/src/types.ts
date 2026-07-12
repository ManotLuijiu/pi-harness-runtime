/**
 * Cost Optimizer Types (RFC-0055)
 */

// Re-export Currency type
export type Currency = "USD" | "THB";

// ─── Cost Entry Types ─────────────────────────────────────────────────

export interface CostEntry {
	id: string;
	jobId: string;
	taskId?: string;
	providerId: string;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	currency: Currency;
	timestamp: string;
}

// ─── Budget Types ─────────────────────────────────────────────────────

export interface CostBudget {
	daily?: number;
	weekly?: number;
	monthly?: number;
	perJob?: number;
	perTask?: number;
}

export interface BudgetStatus {
	daily: { used: number; budget: number; remaining: number };
	weekly: { used: number; budget: number; remaining: number };
	monthly: { used: number; budget: number; remaining: number };
	exhausted: boolean;
	nextReset?: string;
}

export interface CostSummary {
	total: number;
	currency: Currency;
	byProvider: Record<string, number>;
	byModel: Record<string, number>;
	byJob: Record<string, number>;
	period: CostPeriod;
}

export interface CostPeriod {
	start: string;
	end: string;
	type: "day" | "week" | "month" | "custom";
}

// ─── Optimization Types ────────────────────────────────────────────────

export interface CostOptimizerConfig {
	defaultBudget: CostBudget;
	currency: Currency;
	alertThreshold: number;
	autoSwitchToCheaper: boolean;
	maxQualityLossPercent: number;
}

export interface SwitchOptions {
	maxQualityLoss?: number;
	maxLatencyIncrease?: "fast" | "medium" | "slow";
}

export interface ModelSwitchRecommendation {
	currentModel: { id: string; providerId: string };
	recommendedModel: { id: string; providerId: string };
	costSavings: number;
	qualityImpact: number;
	reason: string;
}

export interface CostForecast {
	estimatedTotal: number;
	byTaskType: Record<string, number>;
	confidence: number;
	assumptions: string[];
}

export interface TaskRequirements {
	requiredCapabilities: string[];
	minContextWindow: number;
	maxLatency?: "fast" | "medium" | "slow";
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
}

export interface OptimizedSelection {
	model: { id: string; providerId: string; name: string };
	estimatedCost: number;
	qualityScore: number;
	reason: string;
	tradeoffs: string[];
}

// ─── Optimizer Interface ─────────────────────────────────────────────

export interface CostOptimizer {
	trackCost(entry: Omit<CostEntry, "id" | "timestamp">): CostEntry;
	getSummary(period: CostPeriod): CostSummary;
	getBudgetStatus(): BudgetStatus;
	canAfford(cost: number): boolean;
	shouldSwitchToCheaper(
		currentModel: { id: string; providerId: string },
		requiredCapabilities: string[],
		options?: SwitchOptions,
	): ModelSwitchRecommendation | null;
	forecastCosts(jobRequirements: TaskRequirements[]): CostForecast;
	optimizeModelSelection(
		taskId: string,
		requirements: TaskRequirements,
	): OptimizedSelection[];
}

// ─── Event Types ─────────────────────────────────────────────────────

export type CostOptimizerEvent =
	| { type: "cost.tracked"; entryId: string; cost: number; total: number }
	| { type: "cost.budget_warning"; threshold: number; percentage: number }
	| { type: "cost.budget_exhausted"; period: string }
	| {
			type: "cost.switch_recommended";
			from: string;
			to: string;
			savings: number;
	  }
	| { type: "cost.forecast"; estimated: number; confidence: number }
	| { type: "cost.optimization_applied"; model: string; savings: number };
