/**
 * Budget Management Functions (RFC-0055)
 */
import { isInPeriod } from "./tracker.js";
// Note: getPeriodBoundaries is used internally by tracker.js
/**
 * Calculate budget status for all periods
 */
export function calculateBudgetStatus(entries, budget) {
    const now = new Date();
    // Daily period
    const dailyPeriod = { start: "", end: "", type: "day" };
    dailyPeriod.start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    dailyPeriod.end = now.toISOString();
    const dailyUsed = calculatePeriodTotal(entries, dailyPeriod);
    // Weekly period
    const weeklyPeriod = { start: "", end: "", type: "week" };
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    weeklyPeriod.start = weekStart.toISOString();
    weeklyPeriod.end = now.toISOString();
    const weeklyUsed = calculatePeriodTotal(entries, weeklyPeriod);
    // Monthly period
    const monthlyPeriod = { start: "", end: "", type: "month" };
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthlyPeriod.start = monthStart.toISOString();
    monthlyPeriod.end = now.toISOString();
    const monthlyUsed = calculatePeriodTotal(entries, monthlyPeriod);
    // Calculate exhausted state
    const exhausted = (budget.daily !== undefined && dailyUsed >= budget.daily) ||
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
function calculatePeriodTotal(entries, period) {
    return entries
        .filter((e) => isInPeriod(e.timestamp, period))
        .reduce((sum, e) => sum + e.cost, 0);
}
/**
 * Check if a cost exceeds budget
 */
export function exceedsBudget(_cost, // eslint-disable-line @typescript-eslint/no-unused-vars
budget, status) {
    if (budget.daily !== undefined && _cost > status.daily.remaining) {
        return true;
    }
    if (budget.weekly !== undefined && _cost > status.weekly.remaining) {
        return true;
    }
    if (budget.monthly !== undefined && _cost > status.monthly.remaining) {
        return true;
    }
    return false;
}
/**
 * Get the most restrictive remaining budget
 */
export function getMostRestrictiveBudget(_cost, // eslint-disable-line @typescript-eslint/no-unused-vars
budget, status) {
    const candidates = [];
    if (budget.daily !== undefined) {
        candidates.push({ period: "daily", remaining: status.daily.remaining });
    }
    if (budget.weekly !== undefined) {
        candidates.push({ period: "weekly", remaining: status.weekly.remaining });
    }
    if (budget.monthly !== undefined) {
        candidates.push({ period: "monthly", remaining: status.monthly.remaining });
    }
    if (candidates.length === 0)
        return null;
    return candidates.reduce((most, current) => current.remaining < most.remaining ? current : most);
}
//# sourceMappingURL=budget.js.map