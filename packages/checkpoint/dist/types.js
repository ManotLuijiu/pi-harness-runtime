/**
 * Checkpoint Engine - Types
 *
 * Core types for the enhanced checkpoint system.
 */
// ─── SDK Version ────────────────────────────────────────────────────────────
/**
 * SDK version for compatibility checks
 */
export const SDK_VERSION = "1.0.0";
/**
 * Check if a checkpoint is in legacy format
 */
export function isLegacyCheckpoint(checkpoint) {
    if (typeof checkpoint !== "object" || checkpoint === null) {
        return false;
    }
    const cp = checkpoint;
    return (typeof cp.version === "number" &&
        typeof cp.jobId === "string" &&
        typeof cp.status === "string" &&
        cp.state !== undefined &&
        typeof cp.timestamp === "string");
}
//# sourceMappingURL=types.js.map