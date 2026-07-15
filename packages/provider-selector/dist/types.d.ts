/**
 * Provider Selector Types (RFC-0012)
 */
export type ProviderCapability = "text" | "vision" | "function_calling" | "streaming";
export type ProviderRegion = "us" | "eu" | "asia" | "global";
export interface Provider {
    id: string;
    name: string;
    baseURL: string;
    capabilities: ProviderCapability[];
    region: ProviderRegion;
    inputCostPer1M: number;
    outputCostPer1M: number;
    latencyMs: number;
    qualityScore: number;
    maxContextTokens: number;
    available: boolean;
}
export type SelectionCriteria = "cost" | "latency" | "quality" | "balanced";
export interface SelectionResult {
    provider: Provider;
    reason: string;
    score: number;
    alternatives: Provider[];
}
//# sourceMappingURL=types.d.ts.map