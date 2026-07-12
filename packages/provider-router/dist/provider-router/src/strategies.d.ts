/**
 * Routing Strategies (RFC-0054)
 */
import type { ProviderCandidate, RoutingDecision, RoutingPolicy, RoutingStrategy } from "./types.js";
/**
 * Apply a routing strategy to select the best candidate
 */
export declare function applyStrategy(candidates: ProviderCandidate[], strategy: RoutingStrategy, policy: RoutingPolicy, options?: {
    preferProviders?: string[];
}): ProviderCandidate;
/**
 * Calculate weighted score for a candidate
 */
export declare function calculateWeightedScore(candidate: ProviderCandidate, policy: RoutingPolicy): number;
/**
 * Create a routing decision from a candidate
 */
export declare function createDecision(candidate: ProviderCandidate, reason: string): RoutingDecision;
//# sourceMappingURL=strategies.d.ts.map