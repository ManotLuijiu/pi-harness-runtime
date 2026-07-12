/**
 * Task Compiler - Task Graph Builder
 *
 * Builds the deterministic DAG from compiled tasks,
 * performs topological sort, and detects root/terminal nodes.
 */
import type { CompiledTask, TaskGraph } from "./types.js";
/**
 * Build a TaskGraph from compiled tasks.
 *
 * The graph is built from task dependencies and includes:
 * - Roots: tasks with no incoming dependencies
 * - Terminals: tasks with no outgoing dependencies
 * - Deterministic topological order
 */
export declare function buildGraph(tasks: CompiledTask[]): TaskGraph;
declare const dependents: Map<string, string[]>;
export { dependents };
//# sourceMappingURL=graph.d.ts.map