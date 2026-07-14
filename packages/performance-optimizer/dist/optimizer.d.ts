/**
 * Performance Optimizer (RFC-0056)
 *
 * Analyzes runtime metrics and produces advisory optimization decisions.
 */
import type { PerformanceOptimizationRequest, PerformanceOptimizationPlan, PerformancePolicy, PerformanceOptimizerEvent } from "./types.js";
export declare class PerformanceOptimizer {
    private policy;
    constructor(policy?: Partial<PerformancePolicy>);
    /**
     * Analyze metrics and produce optimization recommendations
     */
    analyze(request: PerformanceOptimizationRequest): PerformanceOptimizationPlan;
    private eventListeners;
    /**
     * Subscribe to optimizer events
     */
    onEvent(listener: (event: PerformanceOptimizerEvent) => void): () => void;
    private emit;
}
export declare function createPerformanceOptimizer(policy?: Partial<PerformancePolicy>): PerformanceOptimizer;
//# sourceMappingURL=optimizer.d.ts.map