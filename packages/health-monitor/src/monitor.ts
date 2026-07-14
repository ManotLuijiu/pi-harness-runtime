/**
 * Health Monitor — Core Monitor
 */

import type {
	ComponentName,
	ComponentHealth,
	HealthReport,
	HealthStatus,
	MonitorConfig,
	RecoveryAction,
} from "./types.js";

export const DEFAULT_CONFIG: Required<MonitorConfig> = {
	checkIntervalMs: 30_000,
	degradedThreshold: 2000,
	unhealthyThreshold: 10_000,
	maxErrorRate: 0.1,
	autoRecover: false,
	maxRecoveryAttempts: 3,
};

const recoveryAttempts = new Map<ComponentName, number>();
const startTime = Date.now();

// ─── Collectors ────────────────────────────────────────────────────────────────

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

export function collectMemory(): { name: string; timestamp: number; values: Record<string, SnapshotValue> } {
	const mem = process.memoryUsage();
	return {
		name: "memory",
		timestamp: Date.now(),
		values: {
			rss: { value: mem.rss, unit: "bytes" },
			heapTotal: { value: mem.heapTotal, unit: "bytes" },
			heapUsed: { value: mem.heapUsed, unit: "bytes" },
			external: { value: mem.external, unit: "bytes" },
		},
	};
}

export function collectCPU(): { name: string; timestamp: number; values: Record<string, SnapshotValue> } {
	const cpu = process.cpuUsage();
	return {
		name: "cpu",
		timestamp: Date.now(),
		values: {
			user: { value: cpu.user, unit: "microseconds" },
			system: { value: cpu.system, unit: "microseconds" },
		},
	};
}

export function collectUptime(): { name: string; timestamp: number; values: Record<string, SnapshotValue> } {
	return {
		name: "uptime",
		timestamp: Date.now(),
		values: {
			seconds: { value: process.uptime(), unit: "seconds" },
		},
	};
}

export function collectSnapshot(): HealthSnapshot {
	return {
		timestamp: Date.now(),
		memory: {
			rss: { value: process.memoryUsage().rss, unit: "bytes" },
			heapUsed: { value: process.memoryUsage().heapUsed, unit: "bytes" },
			heapTotal: { value: process.memoryUsage().heapTotal, unit: "bytes" },
		},
		cpu: {
			user: { value: process.cpuUsage().user, unit: "microseconds" },
			system: { value: process.cpuUsage().system, unit: "microseconds" },
		},
		uptime: process.uptime(),
	};
}

export function determineStatus(
	responseTimeMs: number,
	errorRate: number,
	config: Required<MonitorConfig>,
): HealthStatus {
	if (
		responseTimeMs > config.unhealthyThreshold ||
		errorRate > config.maxErrorRate
	) {
		return "unhealthy";
	}
	if (responseTimeMs > config.degradedThreshold) {
		return "degraded";
	}
	return "healthy";
}

export function createReport(
	components: ComponentHealth[],
	_config: Required<MonitorConfig>,
): HealthReport {
	return {
		overall: aggregateHealth(components.map((c) => c.status)),
		timestamp: new Date().toISOString(),
		components,
		uptime: Math.floor((Date.now() - startTime) / 1000),
	};
}

export function aggregateHealth(statuses: HealthStatus[]): HealthStatus {
	if (statuses.length === 0) return "unknown";
	if (statuses.some((s) => s === "unhealthy")) return "unhealthy";
	if (statuses.some((s) => s === "degraded")) return "degraded";
	if (statuses.every((s) => s === "healthy")) return "healthy";
	return "unknown";
}

export function determineRecoveryAction(
	component: ComponentName,
	status: HealthStatus,
	config: Required<MonitorConfig>,
): RecoveryAction | null {
	if (status === "healthy") return null;
	if (!config.autoRecover) return null;

	const attempts = recoveryAttempts.get(component) ?? 0;
	if (attempts >= config.maxRecoveryAttempts) {
		return {
			type: "alert",
			target: component,
			config: {
				message: `Max recovery attempts (${attempts}) exceeded for ${component}`,
			},
		};
	}

	recoveryAttempts.set(component, attempts + 1);

	if (status === "unhealthy") {
		return {
			type: "restart",
			target: component,
			config: { attempt: attempts + 1 },
		};
	}

	return {
		type: "retry",
		target: component,
		config: { attempt: attempts + 1, backoffMs: 2 ** attempts * 1000 },
	};
}

export function resetRecoveryAttempts(component: ComponentName): void {
	recoveryAttempts.delete(component);
}

export async function runHealthCheck(
	component: ComponentName,
	checkFn: () => Promise<boolean>,
	config: Required<MonitorConfig>,
): Promise<ComponentHealth> {
	const start = Date.now();
	let status: HealthStatus = "healthy";
	let details: string | undefined;

	try {
		const result = await Promise.race([
			checkFn(),
			new Promise<false>((_, reject) =>
				setTimeout(
					() => reject(new Error("timeout")),
					config.unhealthyThreshold,
				),
			),
		]);
		if (!result) {
			status = "unhealthy";
			details = "Check returned false";
		}
	} catch (err) {
		status = "unhealthy";
		details = err instanceof Error ? err.message : "Unknown error";
	}

	const responseTimeMs = Date.now() - start;
	const determined = determineStatus(
		responseTimeMs,
		status === "unhealthy" ? 1 : 0,
		config,
	);

	return {
		component,
		status: determined,
		lastCheck: new Date().toISOString(),
		responseTimeMs,
		errorRate: status === "unhealthy" ? 1 : 0,
		details,
	};
}

export function calculateUptime(report: HealthReport): number {
	return report.overall === "unhealthy" ? 95 : 100;
}
