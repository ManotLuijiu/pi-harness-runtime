/**
 * Context Compiler - Token Budget Fitting
 *
 * Fits optional candidates into the available token budget.
 * Required candidates always fit first.
 * Uses the RFC-0041 character-based estimation (1 token ≈ 4 characters).
 */
import type { CompiledContextItem, ContextCandidate, OmittedItem } from "./types.js";
/**
 * Result of budget fitting.
 */
export interface BudgetFitResult {
    included: ContextCandidate[];
    omitted: OmittedItem[];
    estimatedTokens: number;
}
/**
 * Estimate tokens from content using 4 chars/token approximation.
 */
export declare function estimateTokens(content: string): number;
/**
 * Fit candidates into the token budget.
 *
 * Algorithm:
 * 1. Always include required candidates
 * 2. Sort optional by score (descending)
 * 3. Greedily add optional until budget exhausted
 * 4. Record all omitted with reason "budget"
 *
 * @param candidates - Ranked candidates (highest score first)
 * @param maximumTokens - Available budget
 * @returns Candidates to include and items to omit
 */
export declare function fitToBudget(candidates: Array<{
    candidate: ContextCandidate;
    score: number;
}>, maximumTokens: number): BudgetFitResult;
/**
 * Convert included candidates to compiled items.
 */
export declare function toCompiledItems(candidates: ContextCandidate[]): CompiledContextItem[];
//# sourceMappingURL=budget.d.ts.map