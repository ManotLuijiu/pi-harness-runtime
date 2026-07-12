/**
 * Cost Tracking Functions (RFC-0055)
 */
let idCounter = 0;
/**
 * Generate a unique ID for cost entries
 */
export function generateCostId() {
    return `cost_${Date.now()}_${++idCounter}`;
}
/**
 * Create a new cost entry
 */
export function createCostEntry(entry, id, timestamp) {
    return {
        ...entry,
        id: id ?? generateCostId(),
        timestamp: timestamp ?? new Date().toISOString(),
    };
}
/**
 * Get the period boundaries for a given period type
 */
export function getPeriodBoundaries(period) {
    const now = new Date();
    const end = new Date(now);
    switch (period.type) {
        case "day": {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            return { start, end };
        }
        case "week": {
            const start = new Date(now);
            start.setDate(now.getDate() - now.getDay());
            start.setHours(0, 0, 0, 0);
            return { start, end };
        }
        case "month": {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            return { start, end };
        }
        case "custom": {
            return {
                start: new Date(period.start),
                end: new Date(period.end),
            };
        }
        default:
            return { start: new Date(0), end: now };
    }
}
/**
 * Check if a timestamp falls within a period
 */
export function isInPeriod(timestamp, period) {
    const { start, end } = getPeriodBoundaries(period);
    const ts = new Date(timestamp);
    return ts >= start && ts <= end;
}
/**
 * Calculate summary from cost entries
 */
export function calculateSummary(entries, period) {
    const filtered = entries.filter((e) => isInPeriod(e.timestamp, period));
    const total = filtered.reduce((sum, e) => sum + e.cost, 0);
    const currency = filtered[0]?.currency ?? "USD";
    const byProvider = {};
    const byModel = {};
    const byJob = {};
    for (const entry of filtered) {
        byProvider[entry.providerId] =
            (byProvider[entry.providerId] ?? 0) + entry.cost;
        byModel[entry.modelId] = (byModel[entry.modelId] ?? 0) + entry.cost;
        if (entry.jobId) {
            byJob[entry.jobId] = (byJob[entry.jobId] ?? 0) + entry.cost;
        }
    }
    return {
        total: Math.round(total * 10000) / 10000, // higher precision for small amounts
        currency,
        byProvider,
        byModel,
        byJob,
        period,
    };
}
/**
 * Get total cost for a period
 */
export function getTotalCost(entries, period) {
    const summary = calculateSummary(entries, period);
    return summary.total;
}
//# sourceMappingURL=tracker.js.map