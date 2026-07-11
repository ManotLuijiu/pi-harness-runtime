/**
 * Task Compiler
 *
 * Compiles requirements into executable, dependency-aware task graphs.
 *
 * @example
 * import { compileTasks } from "@pi/task-compiler";
 *
 * const graph = await compileTasks({
 *   requirement: compiledRequirement,
 *   project: projectProfile,
 *   jobId: "job-001",
 * });
 */

// ─── SDK Version ───────────────────────────────────────────────────────

export { SDK_VERSION } from "./types.js";

// ─── Main API ─────────────────────────────────────────────────────────

export { compileTasks } from "./compiler.js";

// ─── Exported types (for consumers) ────────────────────────────────────

export type {
	CompiledTask,
	ComplexityEstimate,
	DependencyInfo,
	FileOwnership,
	FileOwnershipMode,
	TaskCompileInput,
	TaskCompilerConfig,
	TaskGraph,
	TaskOutput,
	TaskType,
} from "./types.js";
export { TaskCompilerError, TaskCompilerErrorCode } from "./types.js";
