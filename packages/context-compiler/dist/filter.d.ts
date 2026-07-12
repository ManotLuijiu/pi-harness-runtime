/**
 * Context Compiler - Policy Filter
 *
 * Enforces deny patterns and size limits before any other processing.
 * This runs first so denied content never reaches the cache.
 */
import type { ContextCandidate, ContextPolicy } from "./types.js";
/**
 * Merge user policy with defaults.
 */
export declare function mergePolicy(user?: Partial<ContextPolicy>): ContextPolicy;
/**
 * Apply policy filters to candidates.
 * Denied and oversized candidates are marked as omitted.
 * This is the first stage — nothing else runs before this.
 *
 * @returns [passed, denied] - denied candidates with policy_denied reason
 */
export declare function applyPolicyFilter(candidates: ContextCandidate[], policy: ContextPolicy): {
    passed: ContextCandidate[];
    denied: Array<{
        candidate: ContextCandidate;
        reason: string;
    }>;
};
//# sourceMappingURL=filter.d.ts.map