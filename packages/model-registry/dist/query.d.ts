/**
 * Model Query Functions (RFC-0053)
 */
import type { ModelFilters, ModelInfo } from "./types.js";
/**
 * Find models matching filters
 */
export declare function findModels(models: ModelInfo[], filters: ModelFilters): ModelInfo[];
/**
 * Get the cheapest model
 */
export declare function getCheapestModel(models: ModelInfo[]): ModelInfo | undefined;
/**
 * Get the model with largest context window
 */
export declare function getLargestContextModel(models: ModelInfo[]): ModelInfo | undefined;
/**
 * Filter by cost efficiency (cost per context window)
 */
export declare function filterByCostEfficiency(models: ModelInfo[]): ModelInfo[];
//# sourceMappingURL=query.d.ts.map