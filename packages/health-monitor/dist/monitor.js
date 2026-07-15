/**
 * Health Monitor — Core Monitor
 */
export const DEFAULT_CONFIG = {
    checkIntervalMs: 30_000,
    degradedThreshold: 2000,
    unhealthyThreshold: 10_000,
    maxErrorRate: 0.1,
    autoRecover: false,
    maxRecoveryAttempts: 3,
};
const recoveryAttempts = new Map();
const startTime = Date.now();
export function collectMemory() {
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
export function collectCPU() {
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
export function collectUptime() {
    return {
        name: "uptime",
        timestamp: Date.now(),
        values: {
            seconds: { value: process.uptime(), unit: "seconds" },
        },
    };
}
export function collectSnapshot() {
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
export function determineStatus(responseTimeMs, errorRate, config) {
    if (responseTimeMs > config.unhealthyThreshold ||
        errorRate > config.maxErrorRate) {
        return "unhealthy";
    }
    if (responseTimeMs > config.degradedThreshold) {
        return "degraded";
    }
    return "healthy";
}
export function createReport(components, _config) {
    return {
        overall: aggregateHealth(components.map((c) => c.status)),
        timestamp: new Date().toISOString(),
        components,
        uptime: Math.floor((Date.now() - startTime) / 1000),
    };
}
export function aggregateHealth(statuses) {
    if (statuses.length === 0)
        return "unknown";
    if (statuses.some((s) => s === "unhealthy"))
        return "unhealthy";
    if (statuses.some((s) => s === "degraded"))
        return "degraded";
    if (statuses.every((s) => s === "healthy"))
        return "healthy";
    return "unknown";
}
export function determineRecoveryAction(component, status, config) {
    if (status === "healthy")
        return null;
    if (!config.autoRecover)
        return null;
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
export function resetRecoveryAttempts(component) {
    recoveryAttempts.delete(component);
}
export async function runHealthCheck(component, checkFn, config) {
    const start = Date.now();
    let status = "healthy";
    let details;
    try {
        const result = await Promise.race([
            checkFn(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), config.unhealthyThreshold)),
        ]);
        if (!result) {
            status = "unhealthy";
            details = "Check returned false";
        }
    }
    catch (err) {
        status = "unhealthy";
        details = err instanceof Error ? err.message : "Unknown error";
    }
    const responseTimeMs = Date.now() - start;
    const determined = determineStatus(responseTimeMs, status === "unhealthy" ? 1 : 0, config);
    return {
        component,
        status: determined,
        lastCheck: new Date().toISOString(),
        responseTimeMs,
        errorRate: status === "unhealthy" ? 1 : 0,
        details,
    };
}
export function calculateUptime(report) {
    return report.overall === "unhealthy" ? 95 : 100;
}
//# sourceMappingURL=monitor.js.map