/**
 * Model Registry Types (RFC-0053)
 */

// ─── Pricing Types ───────────────────────────────────────────────────

export type Currency = "USD" | "THB";

export interface Pricing {
	currency: Currency;
	inputPer1M: number; // cost per 1M input tokens
	outputPer1M: number; // cost per 1M output tokens
	batchInputPer1M?: number;
	cacheReadPer1M?: number;
	cacheWritePer1M?: number;
}

// ─── Model Info ───────────────────────────────────────────────────────

export type ModelStatus = "active" | "deprecated" | "disabled";

export interface ModelInfo {
	id: string;
	providerId: string;
	name: string;
	version?: string;
	contextWindow: number;
	maxOutputTokens: number;
	pricing: Pricing;
	capabilities: string[]; // references to Capability IDs
	aliases: string[];
	status: ModelStatus;
	releasedAt?: string;
	deprecatedAt?: string;
}

// ─── Registry Types ───────────────────────────────────────────────────

export interface ModelFilters {
	providerId?: string;
	minContextWindow?: number;
	maxCostPer1M?: number;
	capabilities?: string[];
	status?: ModelStatus;
}

export interface ModelRegistry {
	register(model: ModelInfo): void;
	unregister(providerId: string, modelId: string): void;
	get(providerId: string, modelId: string): ModelInfo | undefined;
	getByAlias(alias: string): ModelInfo | undefined;
	list(providerId?: string): ModelInfo[];
	listActive(): ModelInfo[];
	find(filters: ModelFilters): ModelInfo[];
	updateStatus(providerId: string, modelId: string, status: ModelStatus): void;
}

// ─── Event Types ─────────────────────────────────────────────────────

export type ModelRegistryEvent =
	| { type: "model.registered"; providerId: string; modelId: string }
	| { type: "model.unregistered"; providerId: string; modelId: string }
	| {
			type: "model.status_changed";
			providerId: string;
			modelId: string;
			status: ModelStatus;
	  }
	| { type: "model.queried"; filters: ModelFilters; results: number };
