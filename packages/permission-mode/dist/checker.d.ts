/**
 * Permission Checker
 *
 * Checks if an action requires approval based on current permission mode.
 */
import type { PermissionMode } from './mode.js';
/**
 * Action that can be checked for permission
 */
export interface Action {
    /** Tool or command name */
    tool: string;
    /** File path if applicable */
    file?: string;
    /** Command string if applicable */
    command?: string;
    /** Additional context */
    context?: Record<string, unknown>;
}
/**
 * Permission check result
 */
export interface PermissionCheck {
    /** Whether approval is required */
    requiresApproval: boolean;
    /** Reason for approval requirement */
    reason?: string;
    /** Tool that triggered the check */
    tool: string;
}
/**
 * Permission Checker
 */
export declare class PermissionChecker {
    private mode;
    private auditLog;
    constructor(mode: PermissionMode);
    /**
     * Update the current permission mode
     */
    setMode(mode: PermissionMode): void;
    /**
     * Get current permission mode
     */
    getMode(): PermissionMode;
    /**
     * Check if an action requires approval
     */
    check(action: Action): PermissionCheck;
    /**
     * Check multiple actions
     */
    checkMany(actions: Action[]): PermissionCheck[];
    /**
     * Get audit log
     */
    getAuditLog(): Array<{
        action: Action;
        result: PermissionCheck;
        timestamp: string;
    }>;
    /**
     * Clear audit log
     */
    clearAuditLog(): void;
}
