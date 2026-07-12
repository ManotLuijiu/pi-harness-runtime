/**
 * Task Compiler - Validation
 *
 * Validates the task graph: cycle detection, file overlap, verification, etc.
 */
import type { TaskGraph } from "./types.js";
/**
 * Assert the graph has no cycles.
 * Uses Kahn's algorithm to verify all tasks are reachable in topological order.
 */
export declare function assertNoCycles(graph: TaskGraph): void;
/**
 * Assert no exclusive file overlap between parallel tasks.
 * Two exclusive tasks cannot modify the same files unless one depends on the other.
 */
export declare function assertNoExclusiveFileOverlap(graph: TaskGraph): void;
/**
 * Assert every task has at least one required verification output.
 */
export declare function assertEveryTaskHasVerification(graph: TaskGraph): void;
/**
 * Assert no task has an empty objective.
 */
export declare function assertNoEmptyObjectives(graph: TaskGraph): void;
/**
 * Assert every acceptance criterion is assigned to at least one task.
 */
export declare function assertEveryCriterionAssigned(graph: TaskGraph, criterionIds: string[]): void;
//# sourceMappingURL=validate.d.ts.map