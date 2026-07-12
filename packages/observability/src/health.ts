/**
 * Observability Package - Health Monitor
 *
 * Health check registration and monitoring.
 */

import type {
	HealthCheck,
	HealthCheckRegistration,
	HealthReport,
	HealthResult,
} from "./types.js";

// ─── Default Configuration ─────────────────────────────────────────────────

const DEFAULT_SERVICE_NAME = "harness-runtime";
const DEFAULT_VERSION = "1.0.0";

// ─── Health Monitor Class ─────────────────────────────────────────────────

export class HealthMonitor {
	private readonly checks: Map<string, HealthCheckRegistration> = new Map();
	private readonly version: string;
	private readonly startTime: number;

	constructor(_serviceName = DEFAULT_SERVICE_NAME, version = DEFAULT_VERSION) {
		this.version = version;
		this.startTime = Date.now();
	}

	/**
	 * Register a health check
	 */
	registerHealthCheck(name: string, check: HealthCheck, critical = true): void {
		this.checks.set(name, {
			name,
			check,
			critical,
		});
	}

	/**
	 * Unregister a health check
	 */
	unregisterHealthCheck(name: string): void {
		this.checks.delete(name);
	}

	/**
	 * Check a single health check
	 */
	async checkHealth(name: string): Promise<HealthResult> {
		const registration = this.checks.get(name);
		if (!registration) {
			return {
				status: "unhealthy",
				message: `Health check '${name}' not found`,
				timestamp: new Date().toISOString(),
			};
		}

		try {
			const timeoutPromise = new Promise<HealthResult>((_, reject) =>
				setTimeout(() => reject(new Error("Health check timeout")), 5000),
			);

			const result = await Promise.race([registration.check(), timeoutPromise]);

			return result;
		} catch (error) {
			return {
				status: "unhealthy",
				message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
				timestamp: new Date().toISOString(),
			};
		}
	}

	/**
	 * Check all health checks
	 */
	async checkHealthAll(): Promise<HealthReport> {
		const checks: Record<string, HealthResult> = {};
		let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

		// Run all checks in parallel
		const results = await Promise.allSettled(
			Array.from(this.checks.entries()).map(async ([_name, registration]) => {
				try {
					const timeoutPromise = new Promise<HealthResult>((_, reject) =>
						setTimeout(() => reject(new Error("Health check timeout")), 5000),
					);

					return await Promise.race([registration.check(), timeoutPromise]);
				} catch (error) {
					return {
						status: "unhealthy" as const,
						message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
						timestamp: new Date().toISOString(),
					};
				}
			}),
		);

		// Process results
		for (let i = 0; i < Array.from(this.checks.entries()).length; i++) {
			const [name] = Array.from(this.checks.entries())[i];
			const result = results[i];

			if (result.status === "fulfilled") {
				checks[name] = result.value;

				// Update overall status
				if (result.value.status === "unhealthy") {
					overallStatus = "unhealthy";
				} else if (
					result.value.status === "degraded" &&
					overallStatus !== "unhealthy"
				) {
					overallStatus = "degraded";
				}
			} else {
				checks[name] = {
					status: "unhealthy",
					message: `Health check threw: ${result.reason}`,
					timestamp: new Date().toISOString(),
				};
				overallStatus = "unhealthy";
			}
		}

		return {
			overall: overallStatus,
			version: this.version,
			uptime: Date.now() - this.startTime,
			checks,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Check liveness probe (simple check that service is running)
	 */
	async checkLiveness(): Promise<HealthResult> {
		return {
			status: "healthy",
			message: "Service is running",
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Check readiness probe (full health check)
	 */
	async checkReadiness(): Promise<HealthResult> {
		const report = await this.checkHealthAll();

		if (report.overall === "healthy") {
			return {
				status: "healthy",
				message: "Service is ready",
				timestamp: new Date().toISOString(),
			};
		}

		if (report.overall === "degraded") {
			return {
				status: "degraded",
				message: "Service is degraded",
				details: {
					failedChecks: Object.keys(report.checks).filter(
						(name) => report.checks[name].status !== "healthy",
					),
				},
				timestamp: new Date().toISOString(),
			};
		}

		return {
			status: "unhealthy",
			message: "Service is not ready",
			details: {
				failedChecks: Object.keys(report.checks).filter(
					(name) => report.checks[name].status !== "healthy",
				),
			},
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Get list of registered health checks
	 */
	listHealthChecks(): string[] {
		return Array.from(this.checks.keys());
	}

	/**
	 * Get health check info
	 */
	getHealthCheck(name: string): HealthCheckRegistration | undefined {
		return this.checks.get(name);
	}
}

// ─── Built-in Health Checks ────────────────────────────────────────────────

/**
 * Create a basic connectivity health check
 */
export function createConnectivityHealthCheck(
	_name: string,
	endpoint: string,
	timeout = 5000,
): HealthCheck {
	return async () => {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			const response = (await fetch(endpoint, {
				method: "GET",
				signal: controller.signal,
			})) as Response & { ok: boolean; status: number };

			clearTimeout(timeoutId);

			if (!response.ok) {
				return {
					status: "degraded",
					message: `Endpoint returned ${response.status}`,
					timestamp: new Date().toISOString(),
				};
			}

			return {
				status: "healthy",
				message: "Connectivity OK",
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			return {
				status: "unhealthy",
				message: `Connectivity check failed: ${error instanceof Error ? error.message : String(error)}`,
				timestamp: new Date().toISOString(),
			};
		}
	};
}

/**
 * Create a memory usage health check
 */
export function createMemoryHealthCheck(
	_name: string,
	thresholdPercent = 90,
): HealthCheck {
	return async () => {
		const usage = process.memoryUsage();
		const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;

		if (heapUsedPercent > thresholdPercent) {
			return {
				status: "unhealthy",
				message: `Memory usage high: ${heapUsedPercent.toFixed(1)}%`,
				details: {
					heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
					heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
					heapUsedPercent,
				},
				timestamp: new Date().toISOString(),
			};
		}

		if (heapUsedPercent > thresholdPercent * 0.8) {
			return {
				status: "degraded",
				message: `Memory usage elevated: ${heapUsedPercent.toFixed(1)}%`,
				details: {
					heapUsedPercent,
				},
				timestamp: new Date().toISOString(),
			};
		}

		return {
			status: "healthy",
			message: `Memory usage OK: ${heapUsedPercent.toFixed(1)}%`,
			details: {
				heapUsedPercent,
			},
			timestamp: new Date().toISOString(),
		};
	};
}

/**
 * Create a disk space health check
 */
export function createDiskSpaceHealthCheck(
	_name: string,
	_minFreeMB = 100,
): HealthCheck {
	return async () => {
		// In Node.js, we'd need to use a native module for disk space
		// For now, return healthy
		return {
			status: "healthy",
			message: "Disk space check not implemented in this environment",
			timestamp: new Date().toISOString(),
		};
	};
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create a health monitor with the given service name
 */
export function createHealthMonitor(
	serviceName?: string,
	version?: string,
): HealthMonitor {
	return new HealthMonitor(serviceName, version);
}
