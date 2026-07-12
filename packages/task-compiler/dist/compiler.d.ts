/**
 * Task Compiler - Main Entry Point
 *
 * Compiles a compiled requirement + project profile into an executable task DAG.
 *
 * Algorithm:
 * 1. Decompose requirement into candidate tasks
 * 2. Assign file scope and ownership
 * 3. Assign verification outputs
 * 4. Apply command policy
 * 5. Build DAG with topological sort
 * 6. Validate: cycles, overlap, verification
 * 7. Assign provider hints
 */
import type { TaskCompileInput, TaskCompilerConfig, TaskGraph } from "./types.js";
/**
 * Compile a requirement + project profile into an executable task graph.
 *
 * This is the main public API for the task compiler.
 */
export declare function compileTasks(input: TaskCompileInput, config?: Partial<TaskCompilerConfig>): Promise<TaskGraph>;
//# sourceMappingURL=compiler.d.ts.map