/**
 * Context Compiler - Deduplication
 *
 * Removes duplicate candidates and merges overlapping source file slices.
 * Uses content normalization for deduplication (same as RFC-0041).
 */
import type { ContextCandidate } from "./types.js";
/**
 * Deduplicate candidates by normalized content.
 * Required candidates are never deduplicated (preserved).
 *
 * For source files with overlapping ranges, merge into a single slice.
 *
 * @returns [uniqueCandidates, duplicateIds]
 */
export declare function deduplicateCandidates(candidates: ContextCandidate[]): {
    unique: ContextCandidate[];
    duplicates: string[];
};
/**
 * Merge overlapping file slices from the same file.
 * Merges adjacent/overlapping line ranges and deduplicates symbols.
 */
export declare function mergeFileSlices(candidates: ContextCandidate[]): ContextCandidate[];
//# sourceMappingURL=deduplicate.d.ts.map