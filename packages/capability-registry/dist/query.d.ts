/**
 * Capability Query Functions (RFC-0051)
 */
import type { Capability, CapabilityQuery, CapabilityProfile, ModelWithCapability } from "./types.js";
/**
 * Query capabilities from a registry store
 */
export declare function queryCapabilities(getAllModelsWithCapability: (capability: Capability) => Array<{
    providerId: string;
    modelId: string;
    profile: CapabilityProfile;
}>, capability: Capability, requirements?: CapabilityQuery): ModelWithCapability[];
/**
 * Find the best model for a capability
 */
export declare function findBestModel(candidates: ModelWithCapability[]): ModelWithCapability | undefined;
/**
 * Filter by latency preference
 */
export declare function filterByLatency(candidates: ModelWithCapability[], preference: "fast" | "balanced" | "quality"): ModelWithCapability[];
//# sourceMappingURL=query.d.ts.map