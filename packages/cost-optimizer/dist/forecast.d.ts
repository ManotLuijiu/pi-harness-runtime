/**
 * Cost Forecasting Functions (RFC-0055)
 */
import type { CostForecast, TaskRequirements } from "./types.js";
/**
 * Forecast costs for a set of job requirements
 */
export declare function forecastCosts(requirements: TaskRequirements[], options?: {
    confidence?: number;
}): CostForecast;
/**
 * Quick forecast for a single task
 */
export declare function quickForecast(inputTokens: number, outputTokens: number): number;
//# sourceMappingURL=forecast.d.ts.map