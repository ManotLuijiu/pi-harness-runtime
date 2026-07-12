/**
 * Capability Registry Types (RFC-0051)
 */

// ─── Capability Types ─────────────────────────────────────────────────

export type Capability =
	| "code_generation"
	| "code_review"
	| "planning"
	| "test_generation"
	| "e2e_testing"
	| "refactoring"
	| "analysis"
	| "debugging"
	| "documentation"
	| "vision"
	| "function_calling"
	| "json_mode"
	| "streaming";

export type Latency = "fast" | "medium" | "slow";

export interface CapabilityProfile {
	capability: Capability;
	score: number; // 0-100, quality rating
	latency: Latency;
	contextWindow: number;
	maxOutputTokens: number;
}

// ─── Query Types ──────────────────────────────────────────────────────

export interface CapabilityQuery {
	minScore?: number;
	maxLatency?: Latency;
	requiresContextWindow?: number;
	requiresMaxOutput?: number;
}

export interface ModelWithCapability {
	providerId: string;
	modelId: string;
	profile: CapabilityProfile;
}

// ─── Registry Types ───────────────────────────────────────────────────

export interface CapabilityRegistry {
	register(
		providerId: string,
		modelId: string,
		capabilities: CapabilityProfile[],
	): void;
	unregister(providerId: string, modelId: string): void;
	getCapabilities(providerId: string, modelId: string): CapabilityProfile[];
	query(
		capability: Capability,
		requirements?: CapabilityQuery,
	): ModelWithCapability[];
	listProviders(): string[];
	listModels(providerId: string): string[];
}

// ─── Event Types ─────────────────────────────────────────────────────

export type CapabilityRegistryEvent =
	| {
			type: "capability.registered";
			providerId: string;
			modelId: string;
			count: number;
	  }
	| { type: "capability.unregistered"; providerId: string; modelId: string }
	| { type: "capability.queried"; capability: Capability; results: number };

// ─── Latency Ranking ─────────────────────────────────────────────────

export const LATENCY_RANK: Record<Latency, number> = {
	fast: 1,
	medium: 2,
	slow: 3,
};
