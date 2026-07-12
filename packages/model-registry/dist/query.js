/**
 * Model Query Functions (RFC-0053)
 */
import { getCostPer1M } from "./cost.js";
/**
 * Find models matching filters
 */
export function findModels(models, filters) {
    let result = [...models];
    // Filter by provider
    if (filters.providerId) {
        result = result.filter((m) => m.providerId === filters.providerId);
    }
    // Filter by context window
    if (filters.minContextWindow !== undefined) {
        result = result.filter((m) => m.contextWindow >= filters.minContextWindow);
    }
    // Filter by cost
    if (filters.maxCostPer1M !== undefined) {
        result = result.filter((m) => getCostPer1M(m.pricing) <= filters.maxCostPer1M);
    }
    // Filter by capabilities
    if (filters.capabilities?.length) {
        result = result.filter((m) => filters.capabilities.every((c) => m.capabilities.includes(c)));
    }
    // Filter by status
    if (filters.status) {
        result = result.filter((m) => m.status === filters.status);
    }
    // Sort by cost (ascending)
    result.sort((a, b) => getCostPer1M(a.pricing) - getCostPer1M(b.pricing));
    return result;
}
/**
 * Get the cheapest model
 */
export function getCheapestModel(models) {
    if (models.length === 0)
        return undefined;
    return models.reduce((cheapest, current) => getCostPer1M(current.pricing) < getCostPer1M(cheapest.pricing)
        ? current
        : cheapest);
}
/**
 * Get the model with largest context window
 */
export function getLargestContextModel(models) {
    if (models.length === 0)
        return undefined;
    return models.reduce((largest, current) => current.contextWindow > largest.contextWindow ? current : largest);
}
/**
 * Filter by cost efficiency (cost per context window)
 */
export function filterByCostEfficiency(models) {
    return [...models].sort((a, b) => {
        const efficiencyA = getCostPer1M(a.pricing) / a.contextWindow;
        const efficiencyB = getCostPer1M(b.pricing) / b.contextWindow;
        return efficiencyA - efficiencyB;
    });
}
//# sourceMappingURL=query.js.map