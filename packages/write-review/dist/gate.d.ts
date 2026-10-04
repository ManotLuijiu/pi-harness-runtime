/**
 * No-Build Gate
 *
 * Blocks build commands until review is approved.
 */
import type { WriteReviewBlackboard } from "./blackboard.js";
import type { WriteReviewStatus } from "./types.js";
/**
 * Check if a command is a build command
 */
export declare function isBuildCommand(command: string): boolean;
/**
 * Gate result
 */
export interface GateResult {
    allowed: boolean;
    reason?: string;
    currentPhase?: string;
    message?: string;
}
/**
 * Check if build is allowed
 */
export declare function checkBuildGate(command: string, blackboard: WriteReviewBlackboard): GateResult;
/**
 * Format gate rejection message
 */
export declare function formatGateRejection(result: GateResult): string;
/**
 * Get phase emoji
 */
export declare function getPhaseEmoji(phase: string): string;
/**
 * Format status for display
 */
export declare function formatStatusDisplay(status: WriteReviewStatus): string;
//# sourceMappingURL=gate.d.ts.map