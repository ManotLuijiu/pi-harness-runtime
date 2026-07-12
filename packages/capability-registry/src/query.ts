/**
 * Capability Query Functions (RFC-0051)
 */

import type {
	Capability,
	CapabilityQuery,
	CapabilityProfile,
	ModelWithCapability,
} from "./types.js";

const LATENCY_ORDER: Record<string, number> = {
	fast: 1,
	medium: 2,
	slow: 3,
};

/**
 * Query capabilities from a registry store
 */
export function queryCapabilities(
	getAllModelsWithCapability: (
		capability: Capability,
	) => Array<{
		providerId: string;
		modelId: string;
		profile: CapabilityProfile;
	}>,
	capability: Capability,
	requirements?: CapabilityQuery,
): ModelWithCapability[] {
	const all = getAllModelsWithCapability(capability);

	return all
		.filter((m) => {
			if (
				requirements?.minScore !== undefined &&
				m.profile.score < requirements.minScore
			) {
				return false;
			}
			if (
				requirements?.maxLatency !== undefined &&
				LATENCY_ORDER[m.profile.latency] >
					LATENCY_ORDER[requirements.maxLatency]
			) {
				return false;
			}
			if (
				requirements?.requiresContextWindow !== undefined &&
				m.profile.contextWindow < requirements.requiresContextWindow
			) {
				return false;
			}
			if (
				requirements?.requiresMaxOutput !== undefined &&
				m.profile.maxOutputTokens < requirements.requiresMaxOutput
			) {
				return false;
			}
			return true;
		})
		.sort((a, b) => b.profile.score - a.profile.score);
}

/**
 * Find the best model for a capability
 */
export function findBestModel(
	candidates: ModelWithCapability[],
): ModelWithCapability | undefined {
	if (candidates.length === 0) return undefined;
	return candidates[0];
}

/**
 * Filter by latency preference
 */
export function filterByLatency(
	candidates: ModelWithCapability[],
	preference: "fast" | "balanced" | "quality",
): ModelWithCapability[] {
	switch (preference) {
		case "fast":
			return candidates.filter((c) => c.profile.latency === "fast");
		case "quality":
			return candidates.sort((a, b) => b.profile.score - a.profile.score);
		case "balanced":
		default:
			// Return all candidates sorted by a balanced score
			return candidates.sort((a, b) => {
				const latencyScoreA = 4 - LATENCY_ORDER[a.profile.latency];
				const latencyScoreB = 4 - LATENCY_ORDER[b.profile.latency];
				const balancedA = a.profile.score * 0.7 + latencyScoreA * 30;
				const balancedB = b.profile.score * 0.7 + latencyScoreB * 30;
				return balancedB - balancedA;
			});
	}
}
