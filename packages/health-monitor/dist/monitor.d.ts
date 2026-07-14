/**
 * Health Monitor — Core Monitor
 */
import type { ComponentName, ComponentHealth, HealthReport, HealthStatus, MonitorConfig, RecoveryAction } from "./types.js";
export declare const DEFAULT_CONFIG: Required<MonitorConfig>;
export interface SnapshotValue {
    value: number;
    unit: string;
}
export interface HealthSnapshot {
    timestamp: number;
    memory: Record<string, SnapshotValue>;
    cpu: Record<string, SnapshotValue>;
    uptime: number;
}
export declare function collectMemory(): {
    name: string;
    timestamp: number;
    values: Record<string, SnapshotValue>;
};
export declare function collectCPU(): {
    name: string;
    timestamp: number;
    values: Record<string, SnapshotValue>;
};
export declare function collectUptime(): {
    name: string;
    timestamp: number;
    values: Record<string, SnapshotValue>;
};
export declare function collectSnapshot(): HealthSnapshot;
export declare function determineStatus(responseTimeMs: number, errorRate: number, config: Required<MonitorConfig>): HealthStatus;
export declare function createReport(components: ComponentHealth[], _config: Required<MonitorConfig>): HealthReport;
export declare function aggregateHealth(statuses: HealthStatus[]): HealthStatus;
export declare function determineRecoveryAction(component: ComponentName, status: HealthStatus, config: Required<MonitorConfig>): RecoveryAction | null;
export declare function resetRecoveryAttempts(component: ComponentName): void;
export declare function runHealthCheck(component: ComponentName, checkFn: () => Promise<boolean>, config: Required<MonitorConfig>): Promise<ComponentHealth>;
export declare function calculateUptime(report: HealthReport): number;
//# sourceMappingURL=monitor.d.ts.map