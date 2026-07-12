/**
 * Enhanced Provider Router (RFC-0054)
 */
import type { ProviderRouter, ProviderRouterEvent, RoutingContext, RoutingDecision, RoutingOptions, RoutingPolicy } from "./types.js";
type EventHandler = (event: ProviderRouterEvent) => void;
/**
 * Enhanced Provider Router with capability and cost awareness
 */
export declare class EnhancedProviderRouter implements ProviderRouter {
    private policy;
    private eventHandlers;
    private defaultCandidates;
    constructor(policy?: RoutingPolicy);
    /**
     * Select the best provider for a task
     */
    selectProvider(task: RoutingContext["task"], context: RoutingContext, options?: RoutingOptions): Promise<RoutingDecision>;
    /**
     * Select multiple providers
     */
    selectProviders(task: RoutingContext["task"], context: RoutingContext, count: number): Promise<RoutingDecision[]>;
    /**
     * Get current routing policy
     */
    getRoutingPolicy(): RoutingPolicy;
    /**
     * Update routing policy
     */
    setRoutingPolicy(policy: RoutingPolicy): void;
    /**
     * Subscribe to events
     */
    onEvent(handler: EventHandler): () => void;
    /**
     * Build candidate list from context
     */
    private buildCandidates;
    /**
     * Filter candidates based on options and context
     */
    private filterCandidates;
    /**
     * Determine routing strategy for a task
     */
    private determineStrategy;
    /**
     * Emit an event
     */
    private emit;
}
/**
 * Create a new provider router
 */
export declare function createProviderRouter(policy?: RoutingPolicy): EnhancedProviderRouter;
export {};
//# sourceMappingURL=provider-router.d.ts.map