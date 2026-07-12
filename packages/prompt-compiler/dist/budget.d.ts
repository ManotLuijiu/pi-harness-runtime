/**
 * Prompt Compiler - Budget / Compaction
 *
 * Compacts optional sections to fit within the token budget.
 * Required sections are never removed.
 * Compaction order (least to most important to keep):
 * 1. Historical logs
 * 2. Previous successful examples
 * 3. Low-priority repository notes
 * 4. Non-blocking discussion
 * 5. Redundant file summaries
 *
 * Priority 0 entries (critical) are never compacted.
 */
import type { PromptSection } from "./types.js";
/**
 * Compaction result.
 */
export interface CompactionResult {
    sections: PromptSection[];
    removed: string[];
    estimatedTokens: number;
}
/**
 * Compact sections to fit within the token budget.
 *
 * Only compactable sections are affected.
 * Required sections are preserved verbatim.
 *
 * @param sections - Input sections
 * @param availableTokens - Maximum tokens available
 * @param estimateTokens - Token estimation function
 * @returns Compacted sections and removed section IDs
 */
export declare function compactToBudget(sections: PromptSection[], availableTokens: number, estimateTokens: (content: string) => number): CompactionResult;
/**
 * Simple word-based token estimator.
 * ~4 characters per token on average.
 */
export declare function estimateTokens(text: string): number;
//# sourceMappingURL=budget.d.ts.map