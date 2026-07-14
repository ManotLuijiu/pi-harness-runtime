/**
 * Health Monitor — Evaluator & Alerts
 */
import type { HealthMetric, HealthThreshold, HealthStatus, HealthAlert } from "./types.js";
export declare const DEFAULT_THRESHOLDS: HealthThreshold[];
/**
 * Evaluate a set of metrics against thresholds
 */
export declare function evaluateHealth(metrics: HealthMetric[], thresholds?: HealthThreshold[]): {
    status: HealthStatus;
    alerts: HealthAlert[];
    summary: Record<string, number>;
};
/**
 * Format alerts for display
 */
export declare function formatAlerts(alerts: HealthAlert[]): string;
/**
 * Detect if a metric is trending toward a threshold
 */
export declare function detectTrend(history: HealthMetric[], metricName: string): "stable" | "rising" | "falling";
//# sourceMappingURL=evaluator.d.ts.map