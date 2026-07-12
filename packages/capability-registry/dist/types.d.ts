/**
 * Capability Registry Types (RFC-0051)
 */
export type Capability = "code_generation" | "code_review" | "planning" | "test_generation" | "e2e_testing" | "refactoring" | "analysis" | "debugging" | "documentation" | "vision" | "function_calling" | "json_mode" | "streaming";
export type Latency = "fast" | "medium" | "slow";
export interface CapabilityProfile {
    capability: Capability;
    score: number;
    latency: Latency;
    contextWindow: number;
    maxOutputTokens: number;
}
export interface CapabilityQuery {
    minScore?: number;
    maxLatency?: Latency;
    requiresContextWindow?: number;
    requiresMaxOutput?: number;
}
export interface ModelWithCapability {
    providerId: string;
    modelId: string;
    profile: CapabilityProfile;
}
export interface CapabilityRegistry {
    register(providerId: string, modelId: string, capabilities: CapabilityProfile[]): void;
    unregister(providerId: string, modelId: string): void;
    getCapabilities(providerId: string, modelId: string): CapabilityProfile[];
    query(capability: Capability, requirements?: CapabilityQuery): ModelWithCapability[];
    listProviders(): string[];
    listModels(providerId: string): string[];
}
export type CapabilityRegistryEvent = {
    type: "capability.registered";
    providerId: string;
    modelId: string;
    count: number;
} | {
    type: "capability.unregistered";
    providerId: string;
    modelId: string;
} | {
    type: "capability.queried";
    capability: Capability;
    results: number;
};
export declare const LATENCY_RANK: Record<Latency, number>;
//# sourceMappingURL=types.d.ts.map