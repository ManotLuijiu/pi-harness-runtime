/**
 * Model Selection Optimization Functions (RFC-0055)
 */
import type { ModelSwitchRecommendation, OptimizedSelection, SwitchOptions, TaskRequirements } from "./types.js";
interface ModelData {
    id: string;
    providerId: string;
    name: string;
    contextWindow: number;
    maxOutputTokens: number;
    pricing: {
        inputPer1M: number;
        outputPer1M: number;
    };
    capabilities: string[];
    latency: "fast" | "medium" | "slow";
    qualityScore: number;
}
/**
 * Calculate cost for a model
 */
export declare function calculateModelCost(model: ModelData, inputTokens: number, outputTokens: number): number;
/**
 * Calculate quality impact between models
 */
export declare function calculateQualityImpact(current: ModelData, candidate: ModelData): number;
/**
 * Get quality score for a model
 */
export declare function getQualityScore(model: ModelData, requiredCapabilities: string[]): number;
/**
 * Find cheaper alternatives for a model
 */
export declare function findCheaperAlternatives(currentModel: ModelData, requiredCapabilities: string[], options?: SwitchOptions): ModelData[];
/**
 * Generate a switch recommendation
 */
export declare function generateSwitchRecommendation(currentModel: ModelData, candidate: ModelData, inputTokens: number, outputTokens: number): ModelSwitchRecommendation;
/**
 * Optimize model selection for a task
 */
export declare function optimizeModelSelection(requirements: TaskRequirements, models?: ModelData[]): OptimizedSelection[];
export {};
//# sourceMappingURL=selection.d.ts.map