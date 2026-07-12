/**
 * Task Compiler - Requirement Decomposition
 *
 * Breaks a compiled requirement into candidate tasks following
 * the standard engineering flow and decomposition policy.
 */
import type { TaskCandidate, TaskCompileInput } from "./types.js";
/**
 * Decompose a compiled requirement into task candidates.
 *
 * Policy: split when different capabilities needed, unrelated modules,
 * incoherent test set, destructive+edit mix, >maxComplexity, or
 * independently-proceeding outputs. Do NOT split to inflate count.
 */
export declare function decomposeRequirement(input: TaskCompileInput): TaskCandidate[];
//# sourceMappingURL=decompose.d.ts.map