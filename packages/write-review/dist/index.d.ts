/**
 * write-review - Two-agent code writing with review loop
 *
 * Integrates with pi-harness-runtime via:
 * - Smart trigger detection (prompt files in wiki/)
 * - System prompt injection for writer agent
 * - Subagent integration for reviewer agent
 *
 * Directory structure: {project}/.write-review/
 */
/**
 * Auto-cleanup old review history files older than MAX_AGE_DAYS
 */
export declare function cleanupOldReviews(projectPath: string): number;
export * from "./types.js";
export * from "./blackboard.js";
export * from "./trigger.js";
export * from "./injection.js";
export * from "./gate.js";
export * from "./review.js";
export * from "./event-bus.js";
//# sourceMappingURL=index.d.ts.map