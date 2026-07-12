/**
 * Cost Calculation Functions (RFC-0053)
 */
import type { ModelInfo, Pricing } from "./types.js";
/**
 * Calculate cost for a model based on token usage
 */
export declare function calculateCost(model: ModelInfo, inputTokens: number, outputTokens: number, options?: {
    useBatch?: boolean;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}): number;
/**
 * Get the total cost per 1M tokens (input + output)
 */
export declare function getCostPer1M(pricing: Pricing): number;
/**
 * Compare two models by cost
 */
export declare function compareCost(modelA: ModelInfo, modelB: ModelInfo): number;
/**
 * Calculate savings between two models
 */
export declare function calculateSavings(currentModel: ModelInfo, newModel: ModelInfo, inputTokens: number, outputTokens: number): {
    absolute: number;
    percentage: number;
};
//# sourceMappingURL=cost.d.ts.map