/**
 * Model Selection Optimization Functions (RFC-0055)
 */

import type {
	ModelSwitchRecommendation,
	OptimizedSelection,
	SwitchOptions,
	TaskRequirements,
} from "./types.js";

// Default model data (would be injected from Model Registry)
interface ModelData {
	id: string;
	providerId: string;
	name: string;
	contextWindow: number;
	maxOutputTokens: number;
	pricing: {
		inputPer1M: number;
		outputPer1M: number;
	};
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
	{
		id: "gpt-4o",
		providerId: "openai",
		name: "GPT-4o",
		contextWindow: 128000,
		maxOutputTokens: 16384,
		pricing: { inputPer1M: 5, outputPer1M: 15 },
		capabilities: [
			"code_generation",
			"code_review",
			"vision",
			"function_calling",
		],
		latency: "medium",
		qualityScore: 92,
	},
];

/**
 * Calculate cost for a model
 */
export function calculateModelCost(
	model: ModelData,
	inputTokens: number,
	outputTokens: number,
): number {
	const inputCost = (inputTokens / 1_000_000) * model.pricing.inputPer1M;
	const outputCost = (outputTokens / 1_000_000) * model.pricing.outputPer1M;
	return Math.round((inputCost + outputCost) * 100) / 100;
}

/**
 * Calculate quality impact between models
 */
export function calculateQualityImpact(
	current: ModelData,
	candidate: ModelData,
): number {
	return current.qualityScore - candidate.qualityScore;
}

/**
 * Get quality score for a model
 */
export function getQualityScore(
	model: ModelData,
	requiredCapabilities: string[],
): number {
	// Base score
	let score = model.qualityScore;

	// Bonus for matching required capabilities
	const matchedCaps = requiredCapabilities.filter((cap) =>
		model.capabilities.includes(cap),
	).length;

	score += matchedCaps * 5;

	return Math.min(score, 100);
}

/**
 * Find cheaper alternatives for a model
 */
export function findCheaperAlternatives(
	currentModel: ModelData,
	requiredCapabilities: string[],
	options?: SwitchOptions,
): ModelData[] {
	const maxQualityLoss = options?.maxQualityLoss ?? 20;

	return DEFAULT_MODELS.filter((m) => {
		// Must be different model
		if (m.id === currentModel.id) return false;

		// Must have required capabilities
		if (!requiredCapabilities.every((cap) => m.capabilities.includes(cap))) {
			return false;
		}

		// Must be cheaper
		const currentCost = calculateModelCost(currentModel, 1000, 500);
		const candidateCost = calculateModelCost(m, 1000, 500);
		if (candidateCost >= currentCost) return false;

		// Must not lose too much quality
		const qualityLoss = calculateQualityImpact(currentModel, m);
		if (qualityLoss > maxQualityLoss) return false;

		// Must not increase latency beyond preference
		if (options?.maxLatencyIncrease) {
			const latencyOrder = { fast: 1, medium: 2, slow: 3 };
			if (latencyOrder[m.latency] > latencyOrder[options.maxLatencyIncrease]) {
				return false;
			}
		}

		return true;
	});
}

/**
 * Generate a switch recommendation
 */
export function generateSwitchRecommendation(
	currentModel: ModelData,
	candidate: ModelData,
	inputTokens: number,
	outputTokens: number,
): ModelSwitchRecommendation {
	const currentCost = calculateModelCost(
		currentModel,
		inputTokens,
		outputTokens,
	);
	const candidateCost = calculateModelCost(
		candidate,
		inputTokens,
		outputTokens,
	);
	const savings = currentCost - candidateCost;
	const savingsPct = (savings / currentCost) * 100;
	const qualityLoss = calculateQualityImpact(currentModel, candidate);

	return {
		currentModel: { id: currentModel.id, providerId: currentModel.providerId },
		recommendedModel: { id: candidate.id, providerId: candidate.providerId },
		costSavings: Math.round(savingsPct * 10) / 10,
		qualityImpact: Math.round(qualityLoss * 10) / 10,
		reason: `Switch from ${currentModel.name} to ${candidate.name} saves ${savingsPct.toFixed(1)}%`,
	};
}

/**
 * Optimize model selection for a task
 */
export function optimizeModelSelection(
	requirements: TaskRequirements,
	models: ModelData[] = DEFAULT_MODELS,
): OptimizedSelection[] {
	// Filter by requirements
	const candidates = models.filter((m) => {
		if (m.contextWindow < requirements.minContextWindow) return false;
		if (requirements.maxLatency) {
			const latencyOrder = { fast: 1, medium: 2, slow: 3 };
			if (latencyOrder[m.latency] > latencyOrder[requirements.maxLatency]) {
				return false;
			}
		}
		// Filter by required capabilities
		if (requirements.requiredCapabilities?.length) {
			const hasAllCaps = requirements.requiredCapabilities.every((cap) =>
				m.capabilities.includes(cap),
			);
			if (!hasAllCaps) return false;
		}
		return true;
	});

	// Calculate scores
	const scored = candidates.map((m) => {
		const estimatedCost = calculateModelCost(
			m,
			requirements.estimatedInputTokens,
			requirements.estimatedOutputTokens,
		);
		const qualityScore = getQualityScore(m, requirements.requiredCapabilities);

		// Tradeoffs
		const tradeoffs: string[] = [];
		if (m.pricing.inputPer1M > 1) tradeoffs.push("Higher input cost");
		if (m.qualityScore < 85) tradeoffs.push("Lower quality rating");

		return {
			model: { id: m.id, providerId: m.providerId, name: m.name },
			estimatedCost,
			qualityScore,
			reason: `${m.name}: $${estimatedCost.toFixed(4)} estimated, ${qualityScore.toFixed(0)} quality`,
			tradeoffs,
		};
	});

	// Sort by quality-adjusted value (Pareto-optimal)
	scored.sort((a, b) => {
		// Quality weight 60%, cost weight 40%
		const valueA = a.qualityScore * 0.6 - a.estimatedCost * 100 * 0.4;
		const valueB = b.qualityScore * 0.6 - b.estimatedCost * 100 * 0.4;
		return valueB - valueA;
	});

	return scored;
}
