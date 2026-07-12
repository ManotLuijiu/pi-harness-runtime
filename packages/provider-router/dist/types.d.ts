/**
 * Provider Router Types (RFC-0054)
 */
import type { ProviderState } from "@pi-harness/types";
import type { Capability } from "@pi-harness/capability-registry";
export type Latency = "fast" | "medium" | "slow";
export type RoutingStrategy = "cheapest" | "fastest" | "best_quality" | "balanced" | "quota_aware";
export interface RoutingPolicy {
    defaultStrategy: RoutingStrategy;
    costWeight: number;
    qualityWeight: number;
    latencyWeight: number;
    quotaWeight: number;
    fallbackProviders: string[];
    taskTypeOverrides: Record<string, RoutingStrategy>;
    providerPreferences: Record<string, number>;
}
export interface QuotaState {
    exhausted: boolean;
    remainingPct: number;
}
export interface RoutingContext {
    task: {
        id: string;
        title: string;
        description: string;
        type: string;
    };
    requirement?: {
        id: string;
        description: string;
    };
    providerStates: Record<string, ProviderState>;
    quotaStates: Record<string, QuotaState>;
    costBudget?: {
        remaining: number;
    };
}
export interface RoutingOptions {
    preferCheapest?: boolean;
    preferFastest?: boolean;
    preferHighestQuality?: boolean;
    maxCostPerTask?: number;
    requiredCapabilities?: Capability[];
    preferProviders?: string[];
    avoidProviders?: string[];
}
export interface ProviderCandidate {
    providerId: string;
    modelId: string;
    capabilities: Capability[];
    estimatedCost?: number;
    estimatedLatency: Latency;
    qualityScore?: number;
    remainingQuotaPct: number;
}
export interface RoutingDecision {
    providerId: string;
    modelId: string;
    reason: string;
    estimatedCost?: number;
    estimatedLatency?: Latency;
    confidence: number;
}
export interface ProviderRouter {
    selectProvider(task: RoutingContext["task"], context: RoutingContext, options?: RoutingOptions): Promise<RoutingDecision>;
    selectProviders(task: RoutingContext["task"], context: RoutingContext, count: number): Promise<RoutingDecision[]>;
    getRoutingPolicy(): RoutingPolicy;
    setRoutingPolicy(policy: RoutingPolicy): void;
}
export type ProviderRouterEvent = {
    type: "router.provider_selected";
    taskId: string;
    providerId: string;
    reason: string;
} | {
    type: "router.no_candidates";
    taskId: string;
    reason: string;
} | {
    type: "router.policy_updated";
    oldPolicy: RoutingPolicy;
    newPolicy: RoutingPolicy;
} | {
    type: "router.fallback_triggered";
    taskId: string;
    originalProvider: string;
    fallbackProvider: string;
};
export declare const LATENCY_RANK: Record<Latency, number>;
//# sourceMappingURL=types.d.ts.map