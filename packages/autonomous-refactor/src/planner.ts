/**
 * Autonomous Refactor — Planning Engine (RFC-0092)
 */

import type {
	RefactorFinding,
	RefactorPlan,
	RefactorConfig,
	RiskLevel,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { calculatePriority } from "./detector.js";

export function createPlan(
	findings: RefactorFinding[],
	config?: Partial<RefactorConfig>,
): RefactorPlan {
	const cfg = { ...DEFAULT_CONFIG, ...config } as Required<RefactorConfig>;

	const riskOrder: Record<RiskLevel, number> = {
		low: 0,
		medium: 1,
		high: 2,
		critical: 3,
	};
	const threshold = riskOrder[cfg.riskThreshold];

	const filtered = findings.filter((f) => riskOrder[f.risk] <= threshold);
	const sorted = [...filtered].sort(
		(a, b) => calculatePriority(b) - calculatePriority(a),
	);
	const limited = sorted.slice(0, cfg.maxFindings);

	const blockers: string[] = [];
	if (cfg.preserveBehavior) {
		blockers.push("All changes must preserve existing behavior");
	}

	const avgRisk =
		limited.reduce((sum, f) => {
			const riskMap: Record<RiskLevel, number> = {
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

export function filterByRisk(
	findings: RefactorFinding[],
	maxRisk: RiskLevel,
): RefactorFinding[] {
	const riskOrder: Record<RiskLevel, number> = {
		low: 0,
		medium: 1,
		high: 2,
		critical: 3,
	};
	const threshold = riskOrder[maxRisk];
	return findings.filter((f) => riskOrder[f.risk] <= threshold);
}

export function groupByFile(
	findings: RefactorFinding[],
): Map<string, RefactorFinding[]> {
	const groups = new Map<string, RefactorFinding[]>();
	for (const f of findings) {
		const existing = groups.get(f.file) ?? [];
		existing.push(f);
		groups.set(f.file, existing);
	}
	return groups;
}

export function groupByType(
	findings: RefactorFinding[],
): Map<RefactorFinding["type"], RefactorFinding[]> {
	const groups = new Map<RefactorFinding["type"], RefactorFinding[]>();
	for (const f of findings) {
		const existing = groups.get(f.type) ?? [];
		existing.push(f);
		groups.set(f.type, existing);
	}
	return groups;
}
