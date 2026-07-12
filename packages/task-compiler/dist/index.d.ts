/**
 * Task Compiler
 *
 * Compiles requirements into executable, dependency-aware task graphs.
 *
 * @example
 * import { compileTasks } from "@pi-harness/task-compiler";
 *
 * const graph = await compileTasks({
 *   requirement: compiledRequirement,
 *   project: projectProfile,
 *   jobId: "job-001",
 * });
 */
export { SDK_VERSION } from "./types.js";
export { compileTasks } from "./compiler.js";
export type { CompiledTask, ComplexityEstimate, DependencyInfo, FileOwnership, FileOwnershipMode, TaskCompileInput, TaskCompilerConfig, TaskGraph, TaskOutput, TaskType, } from "./types.js";
export { TaskCompilerError, TaskCompilerErrorCode } from "./types.js";
//# sourceMappingURL=index.d.ts.map