/**
 * Performance Optimizer (RFC-0056)
 *
 * Re-exports all public types and classes.
 */

export {
	PerformanceOptimizer,
	createPerformanceOptimizer,
} from "./optimizer.js";
export type {
	PerformanceOptimizationRequest,
	PerformanceOptimizationPlan,
	PerformanceRecommendation,
	RuntimeMetricSnapshot,
	ProviderMetric,
	ProviderRuntimeState,
	PerformancePolicy,
	PerformanceOptimizerEvent,
} from "./types.js";
