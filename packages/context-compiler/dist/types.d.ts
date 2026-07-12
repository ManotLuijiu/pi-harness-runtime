/**
 * Context Compiler - Types
 *
 * Type definitions for context compilation pipeline.
 * Every selected item has a source reference; every omitted item has a reason.
 */
/**
 * Kinds of context that can be collected.
 */
export type ContextKind = "project_rule" | "okf_concept" | "source_file" | "git_diff" | "test_failure" | "agent_report" | "blackboard_state";
/**
 * Trust level of a context item.
 */
export type ContextTrust = "authoritative" | "generated" | "unverified";
/**
 * A raw context candidate from a source collector.
 */
export interface ContextCandidate {
    id: string;
    kind: ContextKind;
    content: string;
    source: string;
    priority: 0 | 1 | 2 | 3;
    required: boolean;
    updatedAt?: string;
    trust: ContextTrust;
    /** Content hash for cache invalidation */
    contentHash?: string;
    /** For source files: file path */
    filePath?: string;
    /** For source files: line range */
    startLine?: number;
    endLine?: number;
    /** For source files: matched symbols */
    symbols?: string[];
}
/**
 * Reasons why a candidate was omitted.
 */
export type OmissionReason = "duplicate" | "out_of_scope" | "stale" | "budget" | "policy_denied" | "parsing_failed" | "source_unavailable";
/**
 * An item that was considered but not included in the final context.
 */
export interface OmittedItem {
    id: string;
    kind: ContextKind;
    reason: OmissionReason;
    reasonDetail?: string;
    estimatedTokens: number;
    /** For policy_denied: the rule that denied this item */
    deniedBy?: string;
}
/**
 * An item that made it into the final compiled context.
 */
export interface CompiledContextItem {
    id: string;
    kind: ContextKind;
    content: string;
    source: string;
    priority: 0 | 1 | 2 | 3;
    required: boolean;
    trust: ContextTrust;
    estimatedTokens: number;
    contentHash?: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    symbols?: string[];
}
/**
 * An edge in the context source graph.
 */
export interface ContextSourceEdge {
    from: string;
    to: string;
    label: string;
    weight: number;
}
/**
 * The final compiled context output.
 */
export interface CompiledContext {
    taskId: string;
    items: CompiledContextItem[];
    omitted: OmittedItem[];
    estimatedTokens: number;
    sourceGraph: ContextSourceEdge[];
    generatedAt: string;
    /** Maps original candidate ID to compiled item ID */
    mapping: Record<string, string>;
}
/**
 * Scoring weights for context candidates.
 * Configurable via ContextCompilerConfig.
 */
export interface ScoringWeights {
    priority: number;
    directFileReference: number;
    recentFailureRelevance: number;
    dependencyRelevance: number;
    frameworkRelevance: number;
    stalePenalty: number;
    duplicationPenalty: number;
}
export declare const DEFAULT_SCORING_WEIGHTS: ScoringWeights;
/**
 * Policy rules for context selection.
 */
export interface ContextPolicy {
    deny: string[];
    allowLargeFiles: boolean;
    maxFileBytes: number;
    trustThreshold?: ContextTrust;
}
export declare const DEFAULT_POLICY: ContextPolicy;
/**
 * Input to the context compiler.
 */
export interface ContextCompileRequest {
    jobId: string;
    taskId: string;
    taskObjective: string;
    maximumTokens: number;
    worktreePath: string;
    candidates: ContextCandidate[];
    scoringWeights?: Partial<ScoringWeights>;
    policy?: Partial<ContextPolicy>;
}
/**
 * Reasons for context invalidation.
 */
export type InvalidationReason = "source_hash_changed" | "project_rule_changed" | "required_okf_changed" | "task_objective_changed" | "test_failure_superseded" | "worktree_branch_changed";
export interface ContextInvalidation {
    reason: InvalidationReason;
    taskId: string;
    details?: Record<string, unknown>;
}
export type ContextCompileErrorCode = "MISSING_REQUIRED_SOURCE" | "PARSING_FAILED" | "BLACKBOARD_UNAVAILABLE" | "ALL_SOURCES_FAILED";
/**
 * Context compilation error.
 */
export declare class ContextCompileError extends Error {
    readonly code: ContextCompileErrorCode;
    readonly details?: Record<string, unknown>;
    constructor(code: ContextCompileErrorCode, message: string, details?: Record<string, unknown>);
}
//# sourceMappingURL=types.d.ts.map