/**
 * Cost Forecasting Functions (RFC-0055)
 */

import type { CostForecast, TaskRequirements } from "./types.js";
import { calculateModelCost } from "./selection.js";

// Default model cost per 1K tokens (input + output average)
const AVG_COST_PER_1K = 0.003; // $0.003 per 1K tokens average

/**
 * Forecast costs for a set of job requirements
 */
export function forecastCosts(
	requirements: TaskRequirements[],
	options?: { confidence?: number },
): CostForecast {
	const byTaskType: Record<string, number> = {};
	let total = 0;
	const assumptions: string[] = [];

	for (const req of requirements) {
		// Estimate based on average cost per token
		const avgCostPerToken = AVG_COST_PER_1K / 1000;
		const estimated =
			(req.estimatedInputTokens + req.estimatedOutputTokens) * avgCostPerToken;
		const rounded = Math.round(estimated * 10000) / 10000;

		const taskType = req.requiredCapabilities[0] ?? "general";
		byTaskType[taskType] = (byTaskType[taskType] ?? 0) + rounded;
		total += rounded;
	}

	assumptions.push("Based on average model costs across providers");
	assumptions.push("Does not account for provider-specific pricing variations");
	assumptions.push("Actual costs may vary based on usage patterns");

	// Confidence decreases with more tasks
	const baseConfidence = options?.confidence ?? 0.8;
	const taskCountFactor = Math.max(0.5, 1 - requirements.length * 0.02);
	const confidence = Math.round(baseConfidence * taskCountFactor * 100) / 100;

	return {
		estimatedTotal: Math.round(total * 100) / 100,
		byTaskType,
		confidence,
		assumptions,
	};
}

/**
 * Quick forecast for a single task
 */
export function quickForecast(
	inputTokens: number,
	outputTokens: number,
): number {
	const totalTokens = inputTokens + outputTokens;
	return Math.round(((totalTokens * AVG_COST_PER_1K) / 1000) * 10000) / 10000;
}
