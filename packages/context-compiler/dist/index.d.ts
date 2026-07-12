/**
 * Context Compiler - Public API
 *
 * Bounded context selection engine for pi-harness-runtime.
 *
 * @example
 * import { compileContext } from "@pi/context-compiler";
 *
 * const ctx = await compileContext({
 *   taskId: "task-001",
 *   taskObjective: "Add login feature to src/auth/login.ts",
 *   maximumTokens: 50_000,
 *   candidates: [...],
 * });
 */
export { compileContext } from "./compiler.js";
export { createClock } from "./compiler.js";
export type { Clock, CompiledContextOutput } from "./compiler.js";
export type { ContextKind, ContextTrust, ContextCandidate, OmissionReason, OmittedItem, CompiledContextItem, ContextSourceEdge, CompiledContext, ScoringWeights, ContextPolicy, ContextCompileRequest, InvalidationReason, ContextInvalidation, ContextCompileErrorCode, } from "./types.js";
export { DEFAULT_SCORING_WEIGHTS, DEFAULT_POLICY } from "./types.js";
export { ContextCompileError } from "./types.js";
export { mergePolicy, applyPolicyFilter } from "./filter.js";
export { mergeWeights, rankCandidates } from "./score.js";
export { deduplicateCandidates, mergeFileSlices, } from "./deduplicate.js";
export { fitToBudget, estimateTokens } from "./budget.js";
export { generateCacheKey, shouldInvalidate, extractItemHashes, } from "./cache.js";
export { enrichWithOkf } from "./compiler.js";
export { loadOkfConcepts, okfDirectoryExists, getOkfPath, } from "./okf-loader.js";
export type { OkfConcept } from "./okf-loader.js";
//# sourceMappingURL=index.d.ts.map