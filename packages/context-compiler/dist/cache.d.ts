/**
 * Context Compiler - Cache & Invalidation
 *
 * Generates deterministic cache keys from selected source hashes.
 * Tracks invalidation triggers.
 */
import type { CompiledContext, CompiledContextItem, ContextInvalidation } from "./types.js";
/**
 * Generate a deterministic cache key from compiled context items.
 * Includes source file hashes for content invalidation.
 */
export declare function generateCacheKey(taskId: string, items: CompiledContextItem[], taskObjective: string): string;
/**
 * Check if a compiled context should be invalidated.
 *
 * Invalidation triggers:
 * - A selected source file hash changed
 * - A project rule changed
 * - A required OKF concept changed
 * - The task objective changed
 * - A test failure superseded an old one
 * - Worktree branch/HEAD changed
 */
export declare function shouldInvalidate(previous: CompiledContext, invalidation: ContextInvalidation, currentItemHashes: Map<string, string>): boolean;
/**
 * Generate current item hashes from a compiled context.
 */
export declare function extractItemHashes(items: CompiledContextItem[]): Map<string, string>;
/**
 * Simple deterministic hash for strings.
 * Used for cache keys when crypto is unavailable.
 */
export declare function simpleHash(text: string): string;
//# sourceMappingURL=cache.d.ts.map