/**
 * Context Compiler - Compiler
 *
 * Main entry point for context compilation.
 * Pipeline: collect → policy filter → score → deduplicate → fit budget → source graph.
 */
import type { ContextCompileRequest, ContextSourceEdge, OmittedItem } from "./types.js";
import { toCompiledItems } from "./budget.js";
/**
 * Default clock for generating timestamps.
 */
export declare function createClock(): {
    now: () => Date;
};
export interface Clock {
    now: () => Date;
}
/**
 * Compile context from candidates.
 *
 * Pipeline:
 * 1. Apply policy filter (deny patterns, size limits)
 * 2. Score optional candidates
 * 3. Merge file slices
 * 4. Deduplicate
 * 5. Fit to token budget
 * 6. Generate source graph
 * 7. Return CompiledContext
 */
export declare function compileContext(request: ContextCompileRequest, clock?: Clock): Promise<CompiledContextOutput>;
/**
 * Compiled context output (extended with cache key).
 */
export interface CompiledContextOutput {
    taskId: string;
    items: ReturnType<typeof toCompiledItems>[number][];
    omitted: OmittedItem[];
    estimatedTokens: number;
    sourceGraph: ContextSourceEdge[];
    generatedAt: string;
    mapping: Record<string, string>;
    cacheKey: string;
}
/**
 * Enrich context candidates with OKF concepts from ~/.pi/okf/.
 *
 * This is optional - if the OKF directory doesn't exist,
 * candidates remain unchanged.
 *
 * Usage:
 * ```ts
 * const enriched = enrichWithOkf(candidates);
 * const result = await compileContext({ ...request, candidates: enriched });
 * ```
 */
export declare function enrichWithOkf(candidates: ContextCompileRequest["candidates"], okfPath?: string): ContextCompileRequest["candidates"];
//# sourceMappingURL=compiler.d.ts.map