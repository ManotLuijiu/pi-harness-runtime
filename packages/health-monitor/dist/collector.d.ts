/**
 * Health Monitor — Data Collectors
 *
 * Collects runtime metrics from various sources.
 */
import type { HealthMetric, HealthSnapshot } from "./types.js";
/**
 * Collect memory usage from Node.js
 */
export declare function collectMemory(): HealthMetric;
/**
 * Collect CPU usage
 */
export declare function collectCPU(): HealthMetric;
/**
 * Collect event loop lag
 */
export declare function collectEventLoop(): HealthMetric;
/**
 * Collect process uptime
 */
export declare function collectUptime(): HealthMetric;
/**
 * Collect all available metrics in one snapshot
 */
export declare function collectSnapshot(): HealthSnapshot;
//# sourceMappingURL=collector.d.ts.map