/**
 * Task Compiler - File Scope Assignment
 *
 * Assigns filesInScope and FileOwnership to each compiled task
 * based on the project structure and task type.
 */
import type { CompiledTask, ProjectProfile, TaskCandidate } from "./types.js";
/**
 * Assign file scope and ownership to each task candidate.
 *
 * File scope is determined by:
 * - Task type (implementation → source files, test → test files)
 * - Project structure (detected by Project Analyzer)
 * - Requirement goals and constraints
 */
export declare function assignFileScope(candidates: TaskCandidate[], project: ProjectProfile): CompiledTask[];
//# sourceMappingURL=file-scope.d.ts.map