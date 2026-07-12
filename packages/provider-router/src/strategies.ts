/**
 * Routing Strategies (RFC-0054)
 */

import type {
	ProviderCandidate,
	RoutingDecision,
	RoutingPolicy,
	RoutingStrategy,
} from "./types.js";
import { LATENCY_RANK } from "./types.js";

/**
 * Apply a routing strategy to select the best candidate
 */
export function applyStrategy(
	candidates: ProviderCandidate[],
	strategy: RoutingStrategy,
	policy: RoutingPolicy,
	options?: { preferProviders?: string[] },
): ProviderCandidate {
	switch (strategy) {
		case "cheapest":
			return selectCheapest(candidates);

		case "fastest":
			return selectFastest(candidates);

		case "best_quality":
			return selectBestQuality(candidates);

		case "balanced":
			return selectBalanced(candidates, policy);

		case "quota_aware":
			return selectQuotaAware(candidates);

		default:
			return selectBalanced(candidates, policy);
	}
}

/**
 * Select the cheapest candidate
 */
function selectCheapest(candidates: ProviderCandidate[]): ProviderCandidate {
	return candidates.reduce((cheapest, current) =>
		(current.estimatedCost ?? Infinity) < (cheapest.estimatedCost ?? Infinity)
			? current
			: cheapest,
	);
}

/**
 * Select the fastest candidate
 */
function selectFastest(candidates: ProviderCandidate[]): ProviderCandidate {
	return candidates.reduce((fastest, current) =>
		LATENCY_RANK[current.estimatedLatency] <
		LATENCY_RANK[fastest.estimatedLatency]
			? current
			: fastest,
	);
}

/**
 * Select the highest quality candidate
 */
function selectBestQuality(candidates: ProviderCandidate[]): ProviderCandidate {
	return candidates.reduce((best, current) =>
		(current.qualityScore ?? 0) > (best.qualityScore ?? 0) ? current : best,
	);
}

/**
 * Select based on weighted scoring
 */
function selectBalanced(
	candidates: ProviderCandidate[],
	policy: RoutingPolicy,
): ProviderCandidate {
	return candidates.reduce((best, current) => {
		const scoreBest = calculateWeightedScore(best, policy);
		const scoreCurrent = calculateWeightedScore(current, policy);
		return scoreCurrent > scoreBest ? current : best;
	});
}

/**
 * Select based on quota availability
 */
function selectQuotaAware(candidates: ProviderCandidate[]): ProviderCandidate {
	return candidates.reduce((best, current) => {
		const quotaBest = best.remainingQuotaPct ?? 0;
		const quotaCurrent = current.remainingQuotaPct ?? 0;
		const costBest = best.estimatedCost ?? Infinity;
		const costCurrent = current.estimatedCost ?? Infinity;
		// Prefer high quota / low cost
		const ratioBest = quotaBest / (costBest || 1);
		const ratioCurrent = quotaCurrent / (costCurrent || 1);
		return ratioCurrent > ratioBest ? current : best;
	});
}

/**
 * Calculate weighted score for a candidate
 */
export function calculateWeightedScore(
	candidate: ProviderCandidate,
	policy: RoutingPolicy,
): number {
	// Cost score (inverse - lower is better)
	const maxReasonableCost = 1; // $1 per task
	const costScore =
		100 -
		Math.min(((candidate.estimatedCost ?? 0) * 100) / maxReasonableCost, 100);

	// Quality score (already 0-100)
	const qualityScore = candidate.qualityScore ?? 50;

	// Latency score (inverse)
	const latencyScore = 100 - LATENCY_RANK[candidate.estimatedLatency] * 33;

	// Quota score (0-100)
	const quotaScore = (candidate.remainingQuotaPct ?? 1) * 100;

	// Normalize weights
	const totalWeight =
		policy.costWeight +
		policy.qualityWeight +
		policy.latencyWeight +
		policy.quotaWeight;

	return (
		(costScore * policy.costWeight +
			qualityScore * policy.qualityWeight +
			latencyScore * policy.latencyWeight +
			quotaScore * policy.quotaWeight) /
		totalWeight
	);
}

/**
 * Create a routing decision from a candidate
 */
export function createDecision(
	candidate: ProviderCandidate,
	reason: string,
): RoutingDecision {
	return {
		providerId: candidate.providerId,
		modelId: candidate.modelId,
		reason,
		estimatedCost: candidate.estimatedCost,
		estimatedLatency: candidate.estimatedLatency,
		confidence: candidate.qualityScore ? candidate.qualityScore / 100 : 0.8,
	};
}
