/**
 * Autonomous Refactor — Planning Engine (RFC-0092)
 */
import { DEFAULT_CONFIG } from "./types.js";
import { calculatePriority } from "./detector.js";
export function createPlan(findings, config) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const riskOrder = {
        low: 0,
        medium: 1,
        high: 2,
        critical: 3,
    };
    const threshold = riskOrder[cfg.riskThreshold];
    const filtered = findings.filter((f) => riskOrder[f.risk] <= threshold);
    const sorted = [...filtered].sort((a, b) => calculatePriority(b) - calculatePriority(a));
    const limited = sorted.slice(0, cfg.maxFindings);
    const blockers = [];
    if (cfg.preserveBehavior) {
        blockers.push("All changes must preserve existing behavior");
    }
    const avgRisk = limited.reduce((sum, f) => {
        const riskMap = {
            low: 5,
            medium: 15,
            high: 30,
            critical: 50,
        };
        return sum + (riskMap[f.risk] ?? 0);
    }, 0) / Math.max(limited.length, 1);
    return {
        id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        findings: limited,
        priorityOrder: limited.map((f) => f.id),
        estimatedImpact: {
            complexityReduction: Math.min(avgRisk, 40),
            maintainabilityImprovement: avgRisk * 0.8,
            riskExposure: avgRisk * 0.6,
        },
        blockers,
    };
}
export function filterByRisk(findings, maxRisk) {
    const riskOrder = {
        low: 0,
        medium: 1,
        high: 2,
        critical: 3,
    };
    const threshold = riskOrder[maxRisk];
    return findings.filter((f) => riskOrder[f.risk] <= threshold);
}
export function groupByFile(findings) {
    const groups = new Map();
    for (const f of findings) {
        const existing = groups.get(f.file) ?? [];
        existing.push(f);
        groups.set(f.file, existing);
    }
    return groups;
}
export function groupByType(findings) {
    const groups = new Map();
    for (const f of findings) {
        const existing = groups.get(f.type) ?? [];
        existing.push(f);
        groups.set(f.type, existing);
    }
    return groups;
}
//# sourceMappingURL=planner.js.map