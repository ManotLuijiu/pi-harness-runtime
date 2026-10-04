/**
 * Write-Review Loop Types
 *
 * State machine for two-agent write-review coordination.
 */
/**
 * Review phases
 */
export type ReviewPhase = "idle" | "writing" | "pending_review" | "reviewing" | "approved" | "blocked" | "changes_requested";
/**
 * Review verdict
 */
export type Verdict = "approved" | "changes_requested" | "blocked";
export interface PingPongDecisionSnapshot {
    decision: "run_ping_pong" | "suggest_ping_pong" | "handle_inline";
    score: number;
    runThreshold: number;
    suggestThreshold: number;
    reasons: string[];
    request: string;
    taskId?: string;
    createdAt: string;
}
/**
 * Blackboard status record
 */
export interface WriteReviewStatus {
    projectPath: string;
    phase: ReviewPhase;
    writerDone: boolean;
    writerMessage?: string;
    iteration: number;
    verdict?: Verdict;
    verdictMessage?: string;
    reviewerStarted?: string;
    codeFiles?: string[];
    changesRequested?: string[];
    approvedAt?: string;
    blockedAt?: string;
    mode?: "manual" | "ping_pong";
    pingPong?: PingPongDecisionSnapshot;
    updatedAt: string;
    createdAt: string;
}
/**
 * Review trigger context
 */
export interface ReviewTriggerContext {
    projectPath: string;
    promptFile: string;
    promptContent: string;
    triggerType: "wiki_read" | "manual" | "code_written";
}
/**
 * Extension config
 */
export interface WriteReviewConfig {
    debug?: boolean;
    blackboardDir?: string;
    wikiDir?: string;
    enabled?: boolean;
}
/**
 * Agent roles
 */
export declare const AGENT_ROLES: {
    readonly WRITER: "writer";
    readonly REVIEWER: "reviewer";
    readonly HELPER: "helper";
};
export type AgentRole = (typeof AGENT_ROLES)[keyof typeof AGENT_ROLES];
/**
 * State transition helpers
 */
export declare function isTerminalPhase(phase: ReviewPhase): boolean;
export declare function needsReview(phase: ReviewPhase): boolean;
export declare function canWrite(phase: ReviewPhase): boolean;
//# sourceMappingURL=types.d.ts.map