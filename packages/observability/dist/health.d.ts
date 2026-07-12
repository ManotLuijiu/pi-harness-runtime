/**
 * Observability Package - Health Monitor
 *
 * Health check registration and monitoring.
 */
import type { HealthCheck, HealthCheckRegistration, HealthReport, HealthResult } from "./types.js";
export declare class HealthMonitor {
    private readonly checks;
    private readonly version;
    private readonly startTime;
    constructor(_serviceName?: string, version?: string);
    /**
     * Register a health check
     */
    registerHealthCheck(name: string, check: HealthCheck, critical?: boolean): void;
    /**
     * Unregister a health check
     */
    unregisterHealthCheck(name: string): void;
    /**
     * Check a single health check
     */
    checkHealth(name: string): Promise<HealthResult>;
    /**
     * Check all health checks
     */
    checkHealthAll(): Promise<HealthReport>;
    /**
     * Check liveness probe (simple check that service is running)
     */
    checkLiveness(): Promise<HealthResult>;
    /**
     * Check readiness probe (full health check)
     */
    checkReadiness(): Promise<HealthResult>;
    /**
     * Get list of registered health checks
     */
    listHealthChecks(): string[];
    /**
     * Get health check info
     */
    getHealthCheck(name: string): HealthCheckRegistration | undefined;
}
/**
 * Create a basic connectivity health check
 */
export declare function createConnectivityHealthCheck(_name: string, endpoint: string, timeout?: number): HealthCheck;
/**
 * Create a memory usage health check
 */
export declare function createMemoryHealthCheck(_name: string, thresholdPercent?: number): HealthCheck;
/**
 * Create a disk space health check
 */
export declare function createDiskSpaceHealthCheck(_name: string, _minFreeMB?: number): HealthCheck;
/**
 * Create a health monitor with the given service name
 */
export declare function createHealthMonitor(serviceName?: string, version?: string): HealthMonitor;
//# sourceMappingURL=health.d.ts.map