/**
 * Model Registry Implementation (RFC-0053)
 */

import type {
	ModelFilters,
	ModelInfo,
	ModelRegistry,
	ModelRegistryEvent,
	ModelStatus,
} from "./types.js";
import { DEFAULT_MODELS } from "./defaults.js";
import { findModels } from "./query.js";

type EventHandler = (event: ModelRegistryEvent) => void;

/**
 * In-memory model registry with event emission
 */
export class InMemoryModelRegistry implements ModelRegistry {
	private models: Map<string, ModelInfo> = new Map();
	private aliasIndex: Map<string, ModelInfo> = new Map();
	private eventHandlers: Set<EventHandler> = new Set();

	constructor(loadDefaults = true) {
		if (loadDefaults) {
			this.loadDefaults();
		}
	}

	/**
	 * Load default models
	 */
	private loadDefaults(): void {
		for (const model of DEFAULT_MODELS) {
			this.register(model);
		}
	}

	/**
	 * Create a unique key for provider/model pair
	 */
	private makeKey(providerId: string, modelId: string): string {
		return `${providerId}::${modelId}`;
	}

	/**
	 * Register a model
	 */
	register(model: ModelInfo): void {
		const key = this.makeKey(model.providerId, model.id);
		this.models.set(key, model);

		// Index by aliases
		for (const alias of model.aliases) {
			this.aliasIndex.set(alias.toLowerCase(), model);
		}

		this.emit({
			type: "model.registered",
			providerId: model.providerId,
			modelId: model.id,
		});
	}

	/**
	 * Unregister a model
	 */
	unregister(providerId: string, modelId: string): void {
		const key = this.makeKey(providerId, modelId);
		const model = this.models.get(key);

		if (model) {
			// Remove from alias index
			for (const alias of model.aliases) {
				this.aliasIndex.delete(alias.toLowerCase());
			}
			this.models.delete(key);
		}

		this.emit({
			type: "model.unregistered",
			providerId,
			modelId,
		});
	}

	/**
	 * Get a model by provider and ID
	 */
	get(providerId: string, modelId: string): ModelInfo | undefined {
		const key = this.makeKey(providerId, modelId);
		return this.models.get(key);
	}

	/**
	 * Get a model by alias
	 */
	getByAlias(alias: string): ModelInfo | undefined {
		return this.aliasIndex.get(alias.toLowerCase());
	}

	/**
	 * List all models, optionally filtered by provider
	 */
	list(providerId?: string): ModelInfo[] {
		const all = Array.from(this.models.values());
		if (providerId) {
			return all.filter((m) => m.providerId === providerId);
		}
		return all;
	}

	/**
	 * List only active models
	 */
	listActive(): ModelInfo[] {
		return Array.from(this.models.values()).filter(
			(m) => m.status === "active",
		);
	}

	/**
	 * Find models matching filters
	 */
	find(filters: ModelFilters): ModelInfo[] {
		const results = findModels(this.list(), filters);

		this.emit({
			type: "model.queried",
			filters,
			results: results.length,
		});

		return results;
	}

	/**
	 * Update model status
	 */
	updateStatus(providerId: string, modelId: string, status: ModelStatus): void {
		const key = this.makeKey(providerId, modelId);
		const model = this.models.get(key);

		if (model) {
			model.status = status;
			if (status === "deprecated") {
				model.deprecatedAt = new Date().toISOString();
			}
			this.emit({
				type: "model.status_changed",
				providerId,
				modelId,
				status,
			});
		}
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
	private emit(event: ModelRegistryEvent): void {
		for (const handler of this.eventHandlers) {
			try {
				handler(event);
			} catch {
				// Ignore handler errors
			}
		}
	}
}

/**
 * Create a new model registry
 */
export function createModelRegistry(
	loadDefaults = true,
): InMemoryModelRegistry {
	return new InMemoryModelRegistry(loadDefaults);
}
