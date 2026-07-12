/**
 * Cost Optimizer Implementation (RFC-0055)
 */

import type {
	CostEntry,
	CostOptimizerConfig,
	CostOptimizerEvent,
	CostPeriod,
	CostSummary,
	CostOptimizer,
	ModelSwitchRecommendation,
	OptimizedSelection,
	SwitchOptions,
	TaskRequirements,
} from "./types.js";
import { DEFAULT_CONFIG } from "./config.js";
import { createCostEntry, calculateSummary } from "./tracker.js";
import { calculateBudgetStatus } from "./budget.js";
import {
	findCheaperAlternatives,
	generateSwitchRecommendation,
	optimizeModelSelection,
} from "./selection.js";
import { forecastCosts as calculateForecast } from "./forecast.js";

type EventHandler = (event: CostOptimizerEvent) => void;

interface ModelData {
	id: string;
	providerId: string;
	name: string;
	contextWindow: number;
	maxOutputTokens: number;
	pricing: { inputPer1M: number; outputPer1M: number };
	capabilities: string[];
	latency: "fast" | "medium" | "slow";
	qualityScore: number;
}

const DEFAULT_MODELS: ModelData[] = [
	{
		id: "claude-sonnet-4",
		providerId: "anthropic",
		name: "Claude Sonnet 4",
		contextWindow: 200000,
		maxOutputTokens: 8192,
		pricing: { inputPer1M: 3, outputPer1M: 15 },
		capabilities: ["code_generation", "code_review", "planning", "analysis"],
		latency: "fast",
		qualityScore: 90,
	},
	{
		id: "gpt-4o-mini",
		providerId: "openai",
		name: "GPT-4o Mini",
		contextWindow: 128000,
		maxOutputTokens: 16384,
		pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
		capabilities: ["code_generation", "code_review", "function_calling"],
		latency: "fast",
		qualityScore: 82,
	},
	{
		id: "MiniMax-Text-01",
		providerId: "minimax",
		name: "MiniMax Text 01",
		contextWindow: 1000000,
		maxOutputTokens: 8192,
		pricing: { inputPer1M: 0.1, outputPer1M: 0.5 },
		capabilities: ["code_generation", "function_calling"],
		latency: "fast",
		qualityScore: 75,
	},
	{
		id: "gemini-1.5-flash",
		providerId: "google",
		name: "Gemini 1.5 Flash",
		contextWindow: 1000000,
		maxOutputTokens: 8192,
		pricing: { inputPer1M: 0.035, outputPer1M: 0.14 },
		capabilities: ["code_generation", "vision"],
		latency: "fast",
		qualityScore: 78,
	},
];

/**
 * In-memory Cost Optimizer
 */
export class InMemoryCostOptimizer implements CostOptimizer {
	private config: CostOptimizerConfig;
	private history: CostEntry[] = [];
	private eventHandlers: Set<EventHandler> = new Set();

	constructor(config?: Partial<CostOptimizerConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Track a cost entry
	 */
	trackCost(entry: Omit<CostEntry, "id" | "timestamp">): CostEntry {
		const costEntry = createCostEntry(entry);
		this.history.push(costEntry);

		// Get current total
		const period: CostPeriod = { start: "", end: "", type: "day" };
		const summary = this.getSummary(period);

		this.emit({
			type: "cost.tracked",
			entryId: costEntry.id,
			cost: costEntry.cost,
			total: summary.total,
		});

		// Check budget warnings
		const status = this.getBudgetStatus();
		const dailyPct =
			status.daily.budget > 0 ? status.daily.used / status.daily.budget : 0;

		if (dailyPct >= this.config.alertThreshold) {
			this.emit({
				type: "cost.budget_warning",
				threshold: this.config.alertThreshold,
				percentage: Math.round(dailyPct * 100),
			});
		}

		if (status.exhausted) {
			this.emit({
				type: "cost.budget_exhausted",
				period: "daily",
			});
		}

		return costEntry;
	}

	/**
	 * Get cost summary for a period
	 */
	getSummary(period: CostPeriod): CostSummary {
		return calculateSummary(this.history, period);
	}

	/**
	 * Get current budget status
	 */
	getBudgetStatus() {
		return calculateBudgetStatus(this.history, this.config.defaultBudget);
	}

	/**
	 * Check if a cost can be afforded
	 */
	canAfford(cost: number): boolean {
		const status = this.getBudgetStatus();

		if (this.config.defaultBudget.daily !== undefined) {
			if (cost > status.daily.remaining) return false;
		}
		if (this.config.defaultBudget.weekly !== undefined) {
			if (cost > status.weekly.remaining) return false;
		}
		if (this.config.defaultBudget.monthly !== undefined) {
			if (cost > status.monthly.remaining) return false;
		}

		return true;
	}

	/**
	 * Suggest cheaper alternatives
	 */
	shouldSwitchToCheaper(
		currentModel: { id: string; providerId: string },
		requiredCapabilities: string[],
		options?: SwitchOptions,
	): ModelSwitchRecommendation | null {
		// Find current model
		const current = DEFAULT_MODELS.find(
			(m) =>
				m.id === currentModel.id && m.providerId === currentModel.providerId,
		);

		if (!current) return null;

		// Find cheaper alternatives
		const alternatives = findCheaperAlternatives(
			current,
			requiredCapabilities,
			options,
		);

		if (alternatives.length === 0) return null;

		// Return the best alternative
		const best = alternatives[0];
		return generateSwitchRecommendation(
			current,
			best,
			1000, // Default input tokens for comparison
			500, // Default output tokens for comparison
		);
	}

	/**
	 * Forecast costs for job requirements
	 */
	forecastCosts(jobRequirements: TaskRequirements[]) {
		const forecast = calculateForecast(jobRequirements);

		this.emit({
			type: "cost.forecast",
			estimated: forecast.estimatedTotal,
			confidence: forecast.confidence,
		});

		return forecast;
	}

	/**
	 * Get optimized model selections
	 */
	optimizeModelSelection(
		_taskId: string,
		requirements: TaskRequirements,
	): OptimizedSelection[] {
		return optimizeModelSelection(requirements);
	}

	/**
	 * Subscribe to events
	 */
	onEvent(handler: EventHandler): () => void {
		this.eventHandlers.add(handler);
		return () => this.eventHandlers.delete(handler);
	}

	/**
	 * Emit an event
	 */
	private emit(event: CostOptimizerEvent): void {
		for (const handler of this.eventHandlers) {
			try {
				handler(event);
			} catch {
				// Ignore handler errors
			}
		}
	}

	/**
	 * Get cost history
	 */
	getHistory(): CostEntry[] {
		return [...this.history];
	}

	/**
	 * Clear history
	 */
	clearHistory(): void {
		this.history = [];
	}
}

/**
 * Create a new cost optimizer
 */
export function createCostOptimizer(
	config?: Partial<CostOptimizerConfig>,
): InMemoryCostOptimizer {
	return new InMemoryCostOptimizer(config);
}
