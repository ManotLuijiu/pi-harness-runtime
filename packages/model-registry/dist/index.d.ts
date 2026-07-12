/**
 * Model Registry Package (RFC-0053)
 *
 * A centralized registry for model metadata with pricing.
 *
 * @example
 * ```typescript
 * import { createModelRegistry } from "@pi-harness/model-registry";
 *
 * const registry = createModelRegistry();
 *
 * // Get a model
 * const model = registry.get("anthropic", "claude-sonnet-4");
 *
 * // Find by alias
 * const byAlias = registry.getByAlias("sonnet");
 *
 * // Find active models with capabilities
 * const models = registry.find({
 *   capabilities: ["code_generation"],
 *   status: "active",
 * });
 * ```
 */
export type { Currency, Pricing, ModelStatus, ModelInfo, ModelFilters, ModelRegistry, ModelRegistryEvent, } from "./types.js";
export { InMemoryModelRegistry, createModelRegistry } from "./registry.js";
export { DEFAULT_MODELS } from "./defaults.js";
export { findModels, getCheapestModel, getLargestContextModel, filterByCostEfficiency, } from "./query.js";
export { calculateCost, getCostPer1M, compareCost, calculateSavings, } from "./cost.js";
//# sourceMappingURL=index.d.ts.map