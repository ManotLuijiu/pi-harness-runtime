/**
 * Cost Calculation Functions (RFC-0053)
 */

import type { ModelInfo, Pricing } from "./types.js";

/**
 * Calculate cost for a model based on token usage
 */
export function calculateCost(
	model: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	options?: {
		useBatch?: boolean;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	},
): number {
	const { pricing } = model;

	// Base cost: input + output
	const baseInputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
	const baseOutputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
	let total = baseInputCost + baseOutputCost;

	// Batch discount
	if (options?.useBatch && pricing.batchInputPer1M !== undefined) {
		const batchSavings =
			(inputTokens / 1_000_000) *
			(pricing.inputPer1M - pricing.batchInputPer1M);
		total -= batchSavings;
	}

	// Cache read discount (negative cost = savings)
	if (options?.cacheReadTokens && pricing.cacheReadPer1M !== undefined) {
		total += (options.cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M;
	}

	// Cache write cost
	if (options?.cacheWriteTokens && pricing.cacheWritePer1M !== undefined) {
		total += (options.cacheWriteTokens / 1_000_000) * pricing.cacheWritePer1M;
	}

	return Math.round(total * 100) / 100; // round to cents
}

/**
 * Get the total cost per 1M tokens (input + output)
 */
export function getCostPer1M(pricing: Pricing): number {
	return pricing.inputPer1M + pricing.outputPer1M;
}

/**
 * Compare two models by cost
 */
export function compareCost(modelA: ModelInfo, modelB: ModelInfo): number {
	return getCostPer1M(modelA.pricing) - getCostPer1M(modelB.pricing);
}

/**
 * Calculate savings between two models
 */
export function calculateSavings(
	currentModel: ModelInfo,
	newModel: ModelInfo,
	inputTokens: number,
	outputTokens: number,
): { absolute: number; percentage: number } {
	const currentCost = calculateCost(currentModel, inputTokens, outputTokens);
	const newCost = calculateCost(newModel, inputTokens, outputTokens);
	const absolute = currentCost - newCost;
	const percentage = currentCost > 0 ? (absolute / currentCost) * 100 : 0;

	return {
		absolute: Math.round(absolute * 100) / 100,
		percentage: Math.round(percentage * 10) / 10,
	};
}
