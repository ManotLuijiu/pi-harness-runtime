/**
 * Prompt Compiler - Deduplication
 *
 * Removes duplicate context entries using normalization.
 * Near-duplicate removal is disabled by default (per RFC-0041).
 */
import type { PromptSection } from "./types.js";
/**
 * Deduplicate sections by removing entries with identical normalized text.
 *
 * Uses the RFC-0041 normalization:
 *   normalize(text) = lowercase(collapseWhitespace(stripMarkdownDecoration(text)))
 *
 * Near-duplicate detection is disabled by default (configurable threshold).
 */
export declare function deduplicateSections(sections: PromptSection[], _nearDuplicateThreshold?: number): PromptSection[];
/**
 * Normalize text for deduplication per RFC-0041:
 * - lowercase
 * - collapse whitespace
 * - strip markdown decoration
 */
export declare function normalizeForDeduplication(text: string): string;
//# sourceMappingURL=deduplicate.d.ts.map