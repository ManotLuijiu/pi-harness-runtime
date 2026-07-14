/**
 * Autonomous Refactor — Main Entry (RFC-0092)
 */

export {
	detectRefactorings,
	assessRisk,
	calculatePriority,
} from "./detector.js";
export {
	createPlan,
	filterByRisk,
	groupByFile,
	groupByType,
} from "./planner.js";
export type * from "./types.js";
