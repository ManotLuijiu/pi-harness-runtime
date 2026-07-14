/**
 * Sprint Planner — Sprint Planner (RFC-0074)
 */
import type { Requirement, Sprint, SprintConfig, PlanningResult } from "./types.js";
export declare function createSprintConfig(overrides?: Partial<SprintConfig>): SprintConfig;
export declare function sortRequirements(reqs: Requirement[], strategy: SprintConfig["prioritizationStrategy"]): Requirement[];
export declare function planSprints(requirements: Requirement[], config?: Partial<SprintConfig>): PlanningResult;
export declare function calculateVelocity(sprints: Sprint[]): number;
//# sourceMappingURL=planner.d.ts.map