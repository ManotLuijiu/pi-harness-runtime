/**
 * Health Monitor — Data Collectors
 *
 * Collects runtime metrics from various sources.
 */
// ─── Memory Collector ────────────────────────────────────────────────
/**
 * Collect memory usage from Node.js
 */
export function collectMemory() {
    const usage = process.memoryUsage();
    return {
        name: "memory",
        timestamp: Date.now(),
        values: {
            rss: {
                value: usage.rss,
                unit: "bytes",
                label: "Resident Set Size",
            },
            heapUsed: {
                value: usage.heapUsed,
                unit: "bytes",
                label: "Heap Used",
            },
            heapTotal: {
                value: usage.heapTotal,
                unit: "bytes",
                label: "Heap Total",
            },
            external: {
                value: usage.external,
                unit: "bytes",
                label: "External Memory",
            },
        },
    };
}
// ─── CPU Collector ───────────────────────────────────────────────────
/**
 * Collect CPU usage
 */
export function collectCPU() {
    const cpu = process.cpuUsage();
    return {
        name: "cpu",
        timestamp: Date.now(),
        values: {
            user: {
                value: cpu.user,
                unit: "microseconds",
                label: "User CPU Time",
            },
            system: {
                value: cpu.system,
                unit: "microseconds",
                label: "System CPU Time",
            },
        },
    };
}
// ─── Event Loop Collector ────────────────────────────────────────────
/**
 * Collect event loop lag
 */
export function collectEventLoop() {
    const start = Date.now();
    setImmediate(() => {
        // nothing — measure lag
    });
    const lag = Date.now() - start;
    return {
        name: "eventLoop",
        timestamp: Date.now(),
        values: {
            lag: {
                value: lag,
                unit: "ms",
                label: "Event Loop Lag",
            },
        },
    };
}
// ─── Uptime Collector ────────────────────────────────────────────────
/**
 * Collect process uptime
 */
export function collectUptime() {
    return {
        name: "uptime",
        timestamp: Date.now(),
        values: {
            seconds: {
                value: process.uptime(),
                unit: "seconds",
                label: "Process Uptime",
            },
        },
    };
}
/**
 * Collect all available metrics in one snapshot
 */
export function collectSnapshot() {
    return {
        timestamp: Date.now(),
        metrics: [
            collectMemory(),
            collectCPU(),
            collectEventLoop(),
            collectUptime(),
        ],
    };
}
//# sourceMappingURL=collector.js.map