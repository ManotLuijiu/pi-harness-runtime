/**
 * Permission Mode - Runtime approval system
 * 
 * Inspired by T3Code's permission modes:
 * - Supervised: Requests approval for commands/edits
 * - Auto-accept edits: Approves edits, questions still need approval
 * - Auto: Uses automatic review for routine actions
 * - Full access: No approval needed
 */

export { PermissionMode, type PermissionModeType } from './mode.js';
export { PermissionChecker } from './checker.js';
export { ApprovalManager } from './manager.js';
