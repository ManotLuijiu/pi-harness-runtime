/**
 * Cost Optimizer Implementation (RFC-0055)
 */
import type { CostEntry, CostOptimizerConfig, CostOptimizerEvent, CostPeriod, CostSummary, CostOptimizer, ModelSwitchRecommendation, OptimizedSelection, SwitchOptions, TaskRequirements } from "./types.js";
type EventHandler = (event: CostOptimizerEvent) => void;
/**
 * In-memory Cost Optimizer
 */
export declare class InMemoryCostOptimizer implements CostOptimizer {
    private config;
    private history;
    private eventHandlers;
    constructor(config?: Partial<CostOptimizerConfig>);
    /**
     * Track a cost entry
     */
    trackCost(entry: Omit<CostEntry, "id" | "timestamp">): CostEntry;
    /**
     * Get cost summary for a period
     */
    getSummary(period: CostPeriod): CostSummary;
    /**
     * Get current budget status
     */
    getBudgetStatus(): import("./types.js").BudgetStatus;
    /**
     * Check if a cost can be afforded
     */
    canAfford(cost: number): boolean;
    /**
     * Suggest cheaper alternatives
     */
    shouldSwitchToCheaper(currentModel: {
        id: string;
        providerId: string;
    }, requiredCapabilities: string[], options?: SwitchOptions): ModelSwitchRecommendation | null;
    /**
     * Forecast costs for job requirements
     */
    forecastCosts(jobRequirements: TaskRequirements[]): import("./types.js").CostForecast;
    /**
     * Get optimized model selections
     */
    optimizeModelSelection(_taskId: string, requirements: TaskRequirements): OptimizedSelection[];
    /**
     * Subscribe to events
     */
    onEvent(handler: EventHandler): () => void;
    /**
     * Emit an event
     */
    private emit;
    /**
     * Get cost history
     */
    getHistory(): CostEntry[];
    /**
     * Clear history
     */
    clearHistory(): void;
}
/**
 * Create a new cost optimizer
 */
export declare function createCostOptimizer(config?: Partial<CostOptimizerConfig>): InMemoryCostOptimizer;
export {};
//# sourceMappingURL=optimizer.d.ts.map