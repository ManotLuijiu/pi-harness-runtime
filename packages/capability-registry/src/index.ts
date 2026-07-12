/**
 * Capability Registry Package (RFC-0051)
 *
 * A centralized registry for tracking model capabilities.
 *
 * @example
 * ```typescript
 * import { createCapabilityRegistry } from "@pi-harness/capability-registry";
 *
 * const registry = createCapabilityRegistry();
 *
 * // Query models with code generation capability
 * const models = registry.query("code_generation", { minScore: 80 });
 *
 * // Get capabilities for a specific model
 * const caps = registry.getCapabilities("anthropic", "claude-sonnet-4");
 * ```
 */

// Types
export type {
	Capability,
	Latency,
	CapabilityProfile,
	CapabilityQuery,
	ModelWithCapability,
	CapabilityRegistry,
	CapabilityRegistryEvent,
} from "./types.js";

export { LATENCY_RANK } from "./types.js";

// Registry
export {
	InMemoryCapabilityRegistry,
	createCapabilityRegistry,
} from "./registry.js";

// Defaults
export { DEFAULT_CAPABILITIES } from "./defaults.js";

// Query utilities
export { queryCapabilities, findBestModel, filterByLatency } from "./query.js";
