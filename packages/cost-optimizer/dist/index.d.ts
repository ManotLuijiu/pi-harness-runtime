/**
 * Cost Optimizer Package (RFC-0055)
 *
 * Intelligent cost management with budget tracking, forecasting, and model selection.
 *
 * @example
 * ```typescript
 * import { createCostOptimizer } from "@pi-harness/cost-optimizer";
 *
 * const optimizer = createCostOptimizer();
 *
 * // Track a cost
 * optimizer.trackCost({ jobId: "job-1", cost: 0.5, ... });
 *
 * // Check budget
 * const status = optimizer.getBudgetStatus();
 *
 * // Get optimization suggestions
 * const selections = optimizer.optimizeModelSelection("task-1", requirements);
 * ```
 */
export type { CostEntry, CostBudget, BudgetStatus, CostSummary, CostPeriod, CostOptimizerConfig, SwitchOptions, ModelSwitchRecommendation, CostForecast, TaskRequirements, OptimizedSelection, CostOptimizer, CostOptimizerEvent, } from "./types.js";
export { InMemoryCostOptimizer, createCostOptimizer } from "./optimizer.js";
export { DEFAULT_CONFIG, createOptimizerConfig } from "./config.js";
export { generateCostId, createCostEntry, getPeriodBoundaries, isInPeriod, calculateSummary, getTotalCost, } from "./tracker.js";
export { calculateBudgetStatus, exceedsBudget, getMostRestrictiveBudget, } from "./budget.js";
export { calculateModelCost, calculateQualityImpact, getQualityScore, findCheaperAlternatives, generateSwitchRecommendation, optimizeModelSelection, } from "./selection.js";
export { forecastCosts, quickForecast } from "./forecast.js";
//# sourceMappingURL=index.d.ts.map