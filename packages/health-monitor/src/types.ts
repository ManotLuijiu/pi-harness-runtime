/**
 * Health Monitor — Types
 */

export type ComponentName =
	| "provider-adapter"
	| "skill-registry"
	| "memory-engine"
	| "session-manager"
	| "checkpoint-engine"
	| "quota-manager"
	| "framework-detector";

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface ComponentHealth {
	component: ComponentName;
	status: HealthStatus;
	lastCheck: string;
	responseTimeMs?: number;
	errorRate?: number;
	details?: string;
}

export interface HealthReport {
	overall: HealthStatus;
	timestamp: string;
	components: ComponentHealth[];
	uptime: number;
}

export interface MonitorConfig {
	checkIntervalMs: number;
	degradedThreshold: number;
	unhealthyThreshold: number;
	maxErrorRate: number;
	autoRecover: boolean;
	maxRecoveryAttempts: number;
}

export interface RecoveryAction {
	type: "restart" | "retry" | "fallback" | "alert" | "scale";
	target: ComponentName;
	config: Record<string, unknown>;
}
