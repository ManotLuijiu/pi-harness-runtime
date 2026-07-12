/**
 * Budget Management Functions (RFC-0055)
 */
import type { BudgetStatus, CostBudget, CostEntry } from "./types.js";
/**
 * Calculate budget status for all periods
 */
export declare function calculateBudgetStatus(entries: CostEntry[], budget: CostBudget): BudgetStatus;
/**
 * Check if a cost exceeds budget
 */
export declare function exceedsBudget(_cost: number, // eslint-disable-line @typescript-eslint/no-unused-vars
budget: CostBudget, status: BudgetStatus): boolean;
/**
 * Get the most restrictive remaining budget
 */
export declare function getMostRestrictiveBudget(_cost: number, // eslint-disable-line @typescript-eslint/no-unused-vars
budget: CostBudget, status: BudgetStatus): {
    period: string;
    remaining: number;
} | null;
//# sourceMappingURL=budget.d.ts.map