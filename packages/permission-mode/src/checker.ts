/**
 * Permission Checker
 * 
 * Checks if an action requires approval based on current permission mode.
 */

import type { PermissionMode } from './mode.js';
import { requiresApproval } from './mode.js';

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
export class PermissionChecker {
  private mode: PermissionMode;
  private auditLog: Array<{ action: Action; result: PermissionCheck; timestamp: string }> = [];

  constructor(mode: PermissionMode) {
    this.mode = mode;
  }

  /**
   * Update the current permission mode
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * Get current permission mode
   */
  getMode(): PermissionMode {
    return { ...this.mode };
  }

  /**
   * Check if an action requires approval
   */
  check(action: Action): PermissionCheck {
    const needsApproval = requiresApproval(this.mode, action.tool);
    
    const result: PermissionCheck = {
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
  checkMany(actions: Action[]): PermissionCheck[] {
    return actions.map(action => this.check(action));
  }

  /**
   * Get audit log
   */
  getAuditLog(): Array<{ action: Action; result: PermissionCheck; timestamp: string }> {
    return [...this.auditLog];
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }
}
