/**
 * Budget Management Functions (RFC-0055)
 */

import type {
	BudgetStatus,
	CostBudget,
	CostEntry,
	CostPeriod,
} from "./types.js";
import { getPeriodBoundaries, isInPeriod } from "./tracker.js";

/**
 * Calculate budget status for all periods
 */
export function calculateBudgetStatus(
	entries: CostEntry[],
	budget: CostBudget,
): BudgetStatus {
	const now = new Date();

	// Daily period
	const dailyPeriod: CostPeriod = { start: "", end: "", type: "day" };
	dailyPeriod.start = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).toISOString();
	dailyPeriod.end = now.toISOString();
	const dailyUsed = calculatePeriodTotal(entries, dailyPeriod);

	// Weekly period
	const weeklyPeriod: CostPeriod = { start: "", end: "", type: "week" };
	const weekStart = new Date(now);
	weekStart.setDate(now.getDate() - now.getDay());
	weekStart.setHours(0, 0, 0, 0);
	weeklyPeriod.start = weekStart.toISOString();
	weeklyPeriod.end = now.toISOString();
	const weeklyUsed = calculatePeriodTotal(entries, weeklyPeriod);

	// Monthly period
	const monthlyPeriod: CostPeriod = { start: "", end: "", type: "month" };
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
	monthlyPeriod.start = monthStart.toISOString();
	monthlyPeriod.end = now.toISOString();
	const monthlyUsed = calculatePeriodTotal(entries, monthlyPeriod);

	// Calculate exhausted state
	const exhausted =
		(budget.daily !== undefined && dailyUsed >= budget.daily) ||
		(budget.weekly !== undefined && weeklyUsed >= budget.weekly) ||
		(budget.monthly !== undefined && monthlyUsed >= budget.monthly);

	// Calculate next reset time (simplified - daily reset at midnight)
	const nextReset = new Date(now);
	nextReset.setDate(nextReset.getDate() + 1);
	nextReset.setHours(0, 0, 0, 0);

	return {
		daily: {
			used: dailyUsed,
			budget: budget.daily ?? 0,
			remaining: Math.max(0, (budget.daily ?? Infinity) - dailyUsed),
		},
		weekly: {
			used: weeklyUsed,
			budget: budget.weekly ?? 0,
			remaining: Math.max(0, (budget.weekly ?? Infinity) - weeklyUsed),
		},
		monthly: {
			used: monthlyUsed,
			budget: budget.monthly ?? 0,
			remaining: Math.max(0, (budget.monthly ?? Infinity) - monthlyUsed),
		},
		exhausted,
		nextReset: exhausted ? nextReset.toISOString() : undefined,
	};
}

/**
 * Calculate total cost for a period
 */
function calculatePeriodTotal(
	entries: CostEntry[],
	period: CostPeriod,
): number {
	return entries
		.filter((e) => isInPeriod(e.timestamp, period))
		.reduce((sum, e) => sum + e.cost, 0);
}

/**
 * Check if a cost exceeds budget
 */
export function exceedsBudget(
	cost: number,
	budget: CostBudget,
	status: BudgetStatus,
): boolean {
	if (budget.daily !== undefined && cost > status.daily.remaining) {
		return true;
	}
	if (budget.weekly !== undefined && cost > status.weekly.remaining) {
		return true;
	}
	if (budget.monthly !== undefined && cost > status.monthly.remaining) {
		return true;
	}
	return false;
}

/**
 * Get the most restrictive remaining budget
 */
export function getMostRestrictiveBudget(
	cost: number,
	budget: CostBudget,
	status: BudgetStatus,
): { period: string; remaining: number } | null {
	const candidates: { period: string; remaining: number }[] = [];

	if (budget.daily !== undefined) {
		candidates.push({ period: "daily", remaining: status.daily.remaining });
	}
	if (budget.weekly !== undefined) {
		candidates.push({ period: "weekly", remaining: status.weekly.remaining });
	}
	if (budget.monthly !== undefined) {
		candidates.push({ period: "monthly", remaining: status.monthly.remaining });
	}

	if (candidates.length === 0) return null;

	return candidates.reduce((most, current) =>
		current.remaining < most.remaining ? current : most,
	);
}
