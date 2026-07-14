/**
 * Health Monitor — Evaluator & Alerts
 */
// ─── Default Thresholds ──────────────────────────────────────────────
export const DEFAULT_THRESHOLDS = [
    { metric: "memory_used_percent", warning: 70, critical: 90 },
    { metric: "process_heap_used_percent", warning: 70, critical: 85 },
    { metric: "disk_root_used_percent", warning: 75, critical: 90 },
    { metric: "load_avg_1m", warning: 2, critical: 4 },
];
// ─── Evaluation ───────────────────────────────────────────────────────
/**
 * Evaluate a set of metrics against thresholds
 */
export function evaluateHealth(metrics, thresholds = DEFAULT_THRESHOLDS) {
    const alerts = [];
    const summary = {
        healthy: 0,
        warning: 0,
        critical: 0,
    };
    // Build threshold map
    const thresholdMap = new Map();
    for (const t of thresholds) {
        thresholdMap.set(t.metric, t);
    }
    for (const metric of metrics) {
        const threshold = thresholdMap.get(metric.name);
        if (!threshold)
            continue;
        // Calculate percentage for bytes-based metrics
        let value = metric.value.current;
        if (metric.name === "process_heap_used_percent") {
            // This is already a percentage from collector
            value = metric.value.current;
        }
        else if (metric.value.unit === "bytes" && metric.name === "memory_used_percent") {
            value = metric.value.current;
        }
        let status = "healthy";
        if (threshold.critical !== undefined && value >= threshold.critical) {
            status = "critical";
        }
        else if (threshold.warning !== undefined && value >= threshold.warning) {
            status = "warning";
        }
        summary[status]++;
        if (status !== "healthy") {
            alerts.push({
                metric: metric.name,
                value,
                unit: metric.value.unit,
                status,
                threshold: status === "critical"
                    ? threshold.critical
                    : threshold.warning,
                timestamp: metric.timestamp,
            });
        }
    }
    // Determine overall status
    let overallStatus = "healthy";
    if (summary.critical > 0)
        overallStatus = "critical";
    else if (summary.warning > 0)
        overallStatus = "warning";
    return { status: overallStatus, alerts, summary };
}
// ─── Alert Formatting ────────────────────────────────────────────────
/**
 * Format alerts for display
 */
export function formatAlerts(alerts) {
    if (alerts.length === 0)
        return "All systems healthy ✅";
    const lines = alerts.map((a) => {
        const icon = a.status === "critical" ? "🔴" : "⚠️";
        return `${icon} ${a.metric}: ${a.value}${a.unit} (threshold: ${a.threshold}${a.unit})`;
    });
    return lines.join("\n");
}
// ─── Trend Detection ──────────────────────────────────────────────────
/**
 * Detect if a metric is trending toward a threshold
 */
export function detectTrend(history, metricName) {
    const values = history
        .filter((m) => m.name === metricName)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .map((m) => m.value.current);
    if (values.length < 3)
        return "stable";
    const recent = values.slice(-3);
    const older = values.slice(0, 3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
    const delta = avgRecent - avgOlder;
    const threshold = avgOlder * 0.05; // 5% change threshold
    if (delta > threshold)
        return "rising";
    if (delta < -threshold)
        return "falling";
    return "stable";
}
//# sourceMappingURL=evaluator.js.map