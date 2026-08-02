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

// Re-export all public APIs
export * from "./types.js";
export * from "./blackboard.js";
export * from "./trigger.js";
export * from "./injection.js";
export * from "./gate.js";
export * from "./review.js";
