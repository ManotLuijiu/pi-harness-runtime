/**
 * Cost Tracking Functions (RFC-0055)
 */
import type { CostEntry, CostPeriod, CostSummary } from "./types.js";
/**
 * Generate a unique ID for cost entries
 */
export declare function generateCostId(): string;
/**
 * Create a new cost entry
 */
export declare function createCostEntry(entry: Omit<CostEntry, "id" | "timestamp">, id?: string, timestamp?: string): CostEntry;
/**
 * Get the period boundaries for a given period type
 */
export declare function getPeriodBoundaries(period: CostPeriod): {
    start: Date;
    end: Date;
};
/**
 * Check if a timestamp falls within a period
 */
export declare function isInPeriod(timestamp: string, period: CostPeriod): boolean;
/**
 * Calculate summary from cost entries
 */
export declare function calculateSummary(entries: CostEntry[], period: CostPeriod): CostSummary;
/**
 * Get total cost for a period
 */
export declare function getTotalCost(entries: CostEntry[], period: CostPeriod): number;
//# sourceMappingURL=tracker.d.ts.map