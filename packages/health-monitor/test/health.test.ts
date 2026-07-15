/**
 * Health Monitor Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	DEFAULT_CONFIG,
	determineStatus,
	createReport,
	aggregateHealth,
	determineRecoveryAction,
	resetRecoveryAttempts,
	runHealthCheck,
	calculateUptime,
} from "../src/index.js";
import type { ComponentHealth, HealthStatus } from "../src/index.js";

const healthy: ComponentHealth = {
	component: "provider-adapter",
	status: "healthy",
	lastCheck: new Date().toISOString(),
	responseTimeMs: 50,
	errorRate: 0,
};

const degraded: ComponentHealth = {
	component: "skill-registry",
	status: "degraded",
	lastCheck: new Date().toISOString(),
	responseTimeMs: 3000,
	errorRate: 0.05,
};

const unhealthy: ComponentHealth = {
	component: "memory-engine",
	status: "unhealthy",
	lastCheck: new Date().toISOString(),
	responseTimeMs: 15000,
	errorRate: 0.5,
	details: "Connection refused",
};

describe("DEFAULT_CONFIG", () => {
	it("has sensible defaults", () => {
		expect(DEFAULT_CONFIG.checkIntervalMs).toBe(30_000);
		expect(DEFAULT_CONFIG.degradedThreshold).toBe(2000);
		expect(DEFAULT_CONFIG.unhealthyThreshold).toBe(10_000);
		expect(DEFAULT_CONFIG.maxErrorRate).toBe(0.1);
		expect(DEFAULT_CONFIG.autoRecover).toBe(false);
		expect(DEFAULT_CONFIG.maxRecoveryAttempts).toBe(3);
	});
});

describe("determineStatus", () => {
	it("healthy for fast responses", () =>
		expect(determineStatus(50, 0, DEFAULT_CONFIG)).toBe("healthy"));

	it("degraded for slow responses", () =>
		expect(determineStatus(5000, 0, DEFAULT_CONFIG)).toBe("degraded"));

	it("unhealthy for very slow responses", () =>
		expect(determineStatus(15000, 0, DEFAULT_CONFIG)).toBe("unhealthy"));

	it("unhealthy for high error rate", () =>
		expect(determineStatus(50, 0.5, DEFAULT_CONFIG)).toBe("unhealthy"));

	it("uses custom config", () => {
		const config = { ...DEFAULT_CONFIG, degradedThreshold: 100 };
		expect(determineStatus(150, 0, config)).toBe("degraded");
	});
});

describe("aggregateHealth", () => {
	it("unknown for empty", () => expect(aggregateHealth([])).toBe("unknown"));
	it("healthy when all healthy", () =>
		expect(aggregateHealth(["healthy", "healthy"])).toBe("healthy"));
	it("degraded when any degraded", () =>
		expect(aggregateHealth(["healthy", "degraded"])).toBe("degraded"));
	it("unhealthy when any unhealthy", () =>
		expect(aggregateHealth(["healthy", "unhealthy"])).toBe("unhealthy"));
	it("unhealthy takes precedence", () =>
		expect(aggregateHealth(["degraded", "unhealthy"])).toBe("unhealthy"));
});

describe("createReport", () => {
	it("sets overall status", () => {
		const report = createReport([healthy, degraded], DEFAULT_CONFIG);
		expect(report.overall).toBe("degraded");
		expect(report.components).toHaveLength(2);
	});

	it("sets timestamp", () => {
		const report = createReport([], DEFAULT_CONFIG);
		expect(report.timestamp).toBeDefined();
	});

	it("calculates uptime", () => {
		const report = createReport([], DEFAULT_CONFIG);
		expect(report.uptime).toBeGreaterThanOrEqual(0);
	});

	it("unhealthy overall when component unhealthy", () => {
		const report = createReport([healthy, unhealthy], DEFAULT_CONFIG);
		expect(report.overall).toBe("unhealthy");
	});
});

describe("determineRecoveryAction", () => {
	beforeEach(() => {
		resetRecoveryAttempts("memory-engine");
		resetRecoveryAttempts("skill-registry");
	});

	it("null for healthy", () => {
		expect(
			determineRecoveryAction("provider-adapter", "healthy", DEFAULT_CONFIG),
		).toBeNull();
	});

	it("null when autoRecover false", () => {
		expect(
			determineRecoveryAction("memory-engine", "unhealthy", DEFAULT_CONFIG),
		).toBeNull();
	});

	it("restart for unhealthy when autoRecover true", () => {
		const config = { ...DEFAULT_CONFIG, autoRecover: true };
		const action = determineRecoveryAction(
			"memory-engine",
			"unhealthy",
			config,
		);
		expect(action?.type).toBe("restart");
		expect(action?.target).toBe("memory-engine");
	});

	it("retry for degraded with backoff", () => {
		const config = { ...DEFAULT_CONFIG, autoRecover: true };
		const action = determineRecoveryAction(
			"skill-registry",
			"degraded",
			config,
		);
		expect(action?.type).toBe("retry");
		expect(action?.config.backoffMs ?? 0).toBeGreaterThan(0);
	});

	it("alert after max attempts", () => {
		const config = { ...DEFAULT_CONFIG, autoRecover: true };
		for (let i = 0; i < DEFAULT_CONFIG.maxRecoveryAttempts; i++) {
			determineRecoveryAction("memory-engine", "unhealthy", config);
		}
		const action = determineRecoveryAction(
			"memory-engine",
			"unhealthy",
			config,
		);
		expect(action?.type).toBe("alert");
	});
});

describe("resetRecoveryAttempts", () => {
	it("clears counter", () => {
		const config = { ...DEFAULT_CONFIG, autoRecover: true };
		determineRecoveryAction("memory-engine", "unhealthy", config);
		resetRecoveryAttempts("memory-engine");
		const action = determineRecoveryAction(
			"memory-engine",
			"unhealthy",
			config,
		);
		expect(action?.config.attempt).toBe(1);
	});
});

describe("runHealthCheck", () => {
	it("healthy when check passes", async () => {
		const result = await runHealthCheck(
			"provider-adapter",
			async () => true,
			DEFAULT_CONFIG,
		);
		expect(result.status).toBe("healthy");
		expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
	});

	it("unhealthy when check throws", async () => {
		const result = await runHealthCheck(
			"memory-engine",
			async () => {
				throw new Error("fail");
			},
			DEFAULT_CONFIG,
		);
		expect(result.status).toBe("unhealthy");
		expect(result.details).toContain("fail");
	});

	it("unhealthy when check returns false", async () => {
		const result = await runHealthCheck(
			"skill-registry",
			async () => false,
			DEFAULT_CONFIG,
		);
		expect(result.status).toBe("unhealthy");
	});

	it("records response time", async () => {
		const result = await runHealthCheck(
			"quota-manager",
			async () => {
				await new Promise((r) => setTimeout(r, 10));
				return true;
			},
			DEFAULT_CONFIG,
		);
		expect(result.responseTimeMs).toBeGreaterThanOrEqual(5);
	});
});

describe("calculateUptime", () => {
	it("100 for healthy", () => {
		const report = createReport([healthy], DEFAULT_CONFIG);
		expect(calculateUptime(report)).toBe(100);
	});

	it("95 for unhealthy", () => {
		const report = createReport([unhealthy], DEFAULT_CONFIG);
		expect(calculateUptime(report)).toBe(95);
	});
});
