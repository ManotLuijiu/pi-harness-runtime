/**
 * Delegation Assessment Types
 *
 * Types for consistent delegation assessment for large refactors.
 */
/**
 * Scope estimation for a refactoring task
 */
export interface ScopeFacts {
    /** Estimated number of relevant files affected */
    estimatedFiles: number;
    /** Actual observed number of files (after scanning) */
    observedFiles: number;
    /** Estimated number of call sites/changes */
    estimatedCallSites: number;
    /** Actual observed call sites */
    observedCallSites: number;
    /** Number of independent components/groups */
    independentComponents: number;
    /** Whether changes are tightly coupled (shared APIs) */
    tightlyCoupled: boolean;
    /** Whether transformation is mechanical (safe for scripts) */
    isMechanical: boolean;
    /** Whether transformation is complex (needs reasoning) */
    isComplex: boolean;
    /** File type breakdown */
    fileTypes: Record<string, number>;
    /** Scope fingerprint for change detection */
    fingerprint: string;
}
/**
 * Delegation strategy decision
 */
export type DelegationStrategy = "delegate" | "script_then_delegate" | "script_only" | "single_agent" | "unavailable";
/**
 * Work group for delegation
 */
export interface WorkGroup {
    /** Unique group ID */
    groupId: string;
    /** Human-readable description */
    description: string;
    /** Files owned by this group */
    ownedPaths: string[];
    /** Whether this group is mechanical (script-friendly) */
    isMechanical: boolean;
    /** Assigned child agent ID (if delegated) */
    childId?: string;
    /** Status of this group */
    status: "pending" | "dispatched" | "running" | "completed" | "failed" | "cancelled";
    /** Validation evidence */
    validation?: {
        passed: boolean;
        details: string;
    };
}
/**
 * Delegation decision from Jev or fallback
 */
export interface DelegationDecision {
    /** Strategy selected */
    strategy: DelegationStrategy;
    /** Reason for the decision */
    reason: string;
    /** Proposed work groups (for delegate strategies) */
    workGroups: WorkGroup[];
    /** Validation expectations */
    validationExpectations: string;
    /** Confidence level */
    confidence: "high" | "medium" | "low";
    /** Whether Jev was used */
    jevUsed: boolean;
    /** Reassessment triggers */
    reassessmentTriggers: string[];
}
/**
 * Delegation receipt for persistence
 */
export interface DelegationReceipt {
    /** Version for schema compatibility */
    version: number;
    /** Workspace canonical path */
    workspacePath: string;
    /** Session ID */
    sessionId: string;
    /** Parent task ID */
    parentTaskId: string;
    /** Scope fingerprint */
    scopeFingerprint: string;
    /** Decision made */
    decision: DelegationDecision;
    /** Created timestamp */
    createdAt: number;
    /** Last updated timestamp */
    updatedAt: number;
    /** Status */
    status: "assessing" | "in_progress" | "completed" | "failed" | "cancelled";
    /** Active child IDs */
    childIds: string[];
    /** Outstanding validation items */
    pendingValidation: string[];
    /** User constraints (e.g., no delegation) */
    userConstraints: string[];
}
/**
 * Delegation assessment trigger config
 */
export interface DelegationTriggerConfig {
    /** Minimum files to trigger assessment */
    minFiles: number;
    /** Minimum call sites to trigger assessment */
    minCallSites: number;
    /** Minimum independent components to suggest delegation */
    minIndependentComponents: number;
    /** Whether to assess on scope discovery vs mutation */
    assessOnDiscovery: boolean;
}
/**
 * Default trigger config
 */
export declare const DEFAULT_DELEGATION_TRIGGERS: DelegationTriggerConfig;
/**
 * Extension capability for delegation
 */
export interface ExtensionCapability {
    /** Extension name */
    name: string;
    /** Whether it supports sub-agents */
    supportsSubagents: boolean;
    /** Whether it supports work isolation */
    supportsWorkIsolation: boolean;
    /** Whether it supports cancellation */
    supportsCancellation: boolean;
    /** Supported tool names */
    availableTools: string[];
    /** Verified working */
    verified: boolean;
}
/**
 * Check if delegation should be triggered
 */
export declare function shouldTriggerAssessment(facts: ScopeFacts, config?: DelegationTriggerConfig): boolean;
