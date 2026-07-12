/**
 * Provider Router Package (RFC-0054)
 *
 * Enhanced provider routing with capability, cost, and quota awareness.
 *
 * @example
 * ```typescript
 * import { createProviderRouter, DEFAULT_ROUTING_POLICY } from "@pi-harness/provider-router";
 *
 * const router = createProviderRouter();
 *
 * const decision = await router.selectProvider(task, context, {
 *   preferCheapest: true,
 *   requiredCapabilities: ["code_generation"],
 * });
 * ```
 */
export { LATENCY_RANK } from "./types.js";
// Router
export { EnhancedProviderRouter, createProviderRouter, } from "./provider-router.js";
// Policy
export { DEFAULT_ROUTING_POLICY, createRoutingPolicy } from "./policy.js";
// Strategies
export { applyStrategy, calculateWeightedScore, createDecision, } from "./strategies.js";
//# sourceMappingURL=index.js.map