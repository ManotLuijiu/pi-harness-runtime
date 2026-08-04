/**
 * Write-Review Loop Types
 *
 * State machine for two-agent write-review coordination.
 */
/**
 * Agent roles
 */
export const AGENT_ROLES = {
    WRITER: "writer", // Minimax - reads wiki, writes code
    REVIEWER: "reviewer", // Uses pi-subagents review-loop
    HELPER: "helper", // worker - notes tasks to todo
};
/**
 * State transition helpers
 */
export function isTerminalPhase(phase) {
    return phase === "approved" || phase === "blocked";
}
export function needsReview(phase) {
    return phase === "pending_review" || phase === "reviewing";
}
export function canWrite(phase) {
    return (phase === "idle" || phase === "writing" || phase === "changes_requested");
}
