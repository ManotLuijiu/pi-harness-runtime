/**
 * Sprint Planner — Requirement Decomposer (RFC-0074)
 */
import type { Requirement, Task, StoryPoint } from "./types.js";
/**
 * Decompose a requirement into tasks
 */
export declare function decomposeRequirement(req: Requirement, options?: {
    defaultEstimate?: StoryPoint;
}): Task[];
export declare function assignEstimate(complexity: number): StoryPoint;
export declare function sumPoints(tasks: Task[]): number;
//# sourceMappingURL=decomposer.d.ts.map