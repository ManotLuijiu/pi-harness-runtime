/**
 * Capability Registry Implementation (RFC-0051)
 */

import type {
	Capability,
	CapabilityProfile,
	CapabilityQuery,
	CapabilityRegistry,
	CapabilityRegistryEvent,
	ModelWithCapability,
} from "./types.js";
import { DEFAULT_CAPABILITIES } from "./defaults.js";
import { queryCapabilities } from "./query.js";

type EventHandler = (event: CapabilityRegistryEvent) => void;

/**
 * In-memory capability registry with event emission
 */
export class InMemoryCapabilityRegistry implements CapabilityRegistry {
	private capabilities: Map<string, Map<string, CapabilityProfile[]>> =
		new Map();
	private capabilityIndex: Map<
		Capability,
		Array<{ providerId: string; modelId: string; profile: CapabilityProfile }>
	> = new Map();
	private eventHandlers: Set<EventHandler> = new Set();

	constructor(loadDefaults = true) {
		if (loadDefaults) {
			this.loadDefaults();
		}
	}

	/**
	 * Load default capability profiles
	 */
	private loadDefaults(): void {
		for (const [providerId, models] of Object.entries(DEFAULT_CAPABILITIES)) {
			for (const [modelId, profiles] of Object.entries(models)) {
				this.register(providerId, modelId, profiles);
			}
		}
	}

	/**
	 * Register capabilities for a model
	 */
	register(
		providerId: string,
		modelId: string,
		capabilities: CapabilityProfile[],
	): void {
		const key = this.makeKey(providerId, modelId);

		// Store capabilities
		if (!this.capabilities.has(key)) {
			this.capabilities.set(key, new Map());
		}
		const modelCaps = this.capabilities.get(key)!;
		modelCaps.set(providerId, capabilities);

		// Also store in flat provider/model map
		if (!this.capabilities.has("by_model")) {
			this.capabilities.set("by_model", new Map());
		}
		this.capabilities.get("by_model")!.set(key, capabilities);

		// Update capability index
		for (const profile of capabilities) {
			if (!this.capabilityIndex.has(profile.capability)) {
				this.capabilityIndex.set(profile.capability, []);
			}
			this.capabilityIndex.get(profile.capability)!.push({
				providerId,
				modelId,
				profile,
			});
		}

		this.emit({
			type: "capability.registered",
			providerId,
			modelId,
			count: capabilities.length,
		});
	}

	/**
	 * Unregister a model's capabilities
	 */
	unregister(providerId: string, modelId: string): void {
		const key = this.makeKey(providerId, modelId);
		const existing = this.capabilities.get("by_model")?.get(key);

		if (existing) {
			// Remove from capability index
			for (const profile of existing) {
				const index = this.capabilityIndex.get(profile.capability);
				if (index) {
					const idx = index.findIndex(
						(e) => e.providerId === providerId && e.modelId === modelId,
					);
					if (idx >= 0) {
						index.splice(idx, 1);
					}
				}
			}

			// Remove from storage
			this.capabilities.get("by_model")?.delete(key);
		}

		this.emit({
			type: "capability.unregistered",
			providerId,
			modelId,
		});
	}

	/**
	 * Get capabilities for a specific model
	 */
	getCapabilities(providerId: string, modelId: string): CapabilityProfile[] {
		const key = this.makeKey(providerId, modelId);
		return this.capabilities.get("by_model")?.get(key) ?? [];
	}

	/**
	 * Query models by capability
	 */
	query(
		capability: Capability,
		requirements?: CapabilityQuery,
	): ModelWithCapability[] {
		const results = queryCapabilities(
			(cap) => this.capabilityIndex.get(cap) ?? [],
			capability,
			requirements,
		);

		this.emit({
			type: "capability.queried",
			capability,
			results: results.length,
		});

		return results;
	}

	/**
	 * List all registered providers
	 */
	listProviders(): string[] {
		const providers = new Set<string>();
		for (const key of this.capabilities.get("by_model")?.keys() ?? []) {
			const [providerId] = this.parseKey(key);
			providers.add(providerId);
		}
		return Array.from(providers);
	}

	/**
	 * List all models for a provider
	 */
	listModels(providerId: string): string[] {
		const models: string[] = [];
		for (const key of this.capabilities.get("by_model")?.keys() ?? []) {
			const [p, modelId] = this.parseKey(key);
			if (p === providerId) {
				models.push(modelId);
			}
		}
		return models;
	}

	/**
	 * Subscribe to events
	 */
	onEvent(handler: EventHandler): () => void {
		this.eventHandlers.add(handler);
		return () => this.eventHandlers.delete(handler);
	}

	/**
	 * Emit an event to all handlers
	 */
	private emit(event: CapabilityRegistryEvent): void {
		for (const handler of this.eventHandlers) {
			try {
				handler(event);
			} catch {
				// Ignore handler errors
			}
		}
	}

	/**
	 * Create a unique key for provider/model pair
	 */
	private makeKey(providerId: string, modelId: string): string {
		return `${providerId}::${modelId}`;
	}

	/**
	 * Parse a key into provider/model
	 */
	private parseKey(key: string): [string, string] {
		const [providerId, modelId] = key.split("::");
		return [providerId, modelId];
	}
}

/**
 * Create a new capability registry
 */
export function createCapabilityRegistry(
	loadDefaults = true,
): InMemoryCapabilityRegistry {
	return new InMemoryCapabilityRegistry(loadDefaults);
}
