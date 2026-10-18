/**
 * Permission Checker
 *
 * Checks if an action requires approval based on current permission mode.
 */
import { requiresApproval } from './mode.js';
/**
 * Permission Checker
 */
export class PermissionChecker {
    mode;
    auditLog = [];
    constructor(mode) {
        this.mode = mode;
    }
    /**
     * Update the current permission mode
     */
    setMode(mode) {
        this.mode = mode;
    }
    /**
     * Get current permission mode
     */
    getMode() {
        return { ...this.mode };
    }
    /**
     * Check if an action requires approval
     */
    check(action) {
        const needsApproval = requiresApproval(this.mode, action.tool);
        const result = {
            requiresApproval: needsApproval,
            tool: action.tool,
            reason: needsApproval ? `Tool "${action.tool}" requires approval in ${this.mode.type} mode` : undefined,
        };
        // Audit log
        this.auditLog.push({
            action,
            result,
            timestamp: new Date().toISOString(),
        });
        return result;
    }
    /**
     * Check multiple actions
     */
    checkMany(actions) {
        return actions.map(action => this.check(action));
    }
    /**
     * Get audit log
     */
    getAuditLog() {
        return [...this.auditLog];
    }
    /**
     * Clear audit log
     */
    clearAuditLog() {
        this.auditLog = [];
    }
}
