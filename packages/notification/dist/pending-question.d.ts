/**
 * Pending Question Controller
 *
 * Manages pending questions that require human response.
 * Supports multiple channels (Telegram, LINE) and Jev evaluation.
 */
/**
 * Question kinds
 */
export type QuestionKind = "routine" | "approval" | "clarification" | "explicit";
/**
 * Question states
 */
export type QuestionState = "pending" | "evaluating" | "resolved" | "cancelled" | "expired";
/**
 * The typed outcome of a Jev evaluation.
 *
 * It is deliberately not the same shape as a human answer: an autonomous
 * decision is never reported as a user "yes".
 */
export type JevOutcome = "approve" | "reject" | "wait" | "proceed_with_caution";
/** Who resolved the question. */
export type ResolutionSource = "user" | "jev" | "timeout";
/** The channel a human answer came from. */
export type ResolutionChannel = "telegram" | "line" | "pi";
/**
 * Channel delivery states
 */
export interface ChannelDeliveryState {
    delivered: boolean;
    deliveredAt?: Date;
    error?: string;
}
/**
 * Pending Question
 */
export interface PendingQuestion {
    /** Unique request ID for this question */
    requestId: string;
    /** Session ID */
    sessionId: string;
    /** Workspace path */
    workspacePath: string;
    /** Job ID if associated */
    jobId?: string;
    /** The question text */
    questionText: string;
    /** Question kind */
    kind: QuestionKind;
    /** Does the proposed action need an explicit human authorization? */
    requiresExplicitAuthorization?: boolean;
    /** Can the proposed action destroy or damage something? */
    destructive?: boolean;
    /** Can the proposed action be undone? */
    reversible?: boolean;
    /** Does the proposed action reach the outside world? */
    external?: boolean;
    /** The signals the risk facts were derived from. */
    riskSignals?: string[];
    /** Current state */
    state: QuestionState;
    /** When created */
    createdAt: Date;
    /** When evaluation is due (for Jev) */
    dueAt?: Date;
    /** When resolved */
    resolvedAt?: Date;
    /** Resolution: "yes", "no", "clarification", or undefined */
    resolution?: "yes" | "no" | "clarification";
    /** Who resolved it */
    resolvedBy?: ResolutionSource;
    /** The channel a human answer came from. Unset for a Jev resolution. */
    resolvedChannel?: ResolutionChannel;
    /** The Jev outcome, when the decision was autonomous. */
    jevOutcome?: JevOutcome;
    /** The short reason of the Jev decision. */
    jevReason?: string;
    /** Channel delivery states */
    deliveryState: {
        telegram?: ChannelDeliveryState;
        line?: ChannelDeliveryState;
    };
    /** Whether user was notified */
    userNotified: boolean;
    /** For deduplication: last notified question text */
    lastNotifiedQuestion?: string;
    /** State revision for deduplication */
    revision: number;
}
/**
 * Question detection result
 */
export interface DetectionResult {
    detected: boolean;
    questionText?: string;
    kind?: QuestionKind;
    isRoutine?: boolean;
}
/**
 * Jev evaluation result
 */
export interface JevDecision {
    action: "continue" | "wait" | "clarify" | "stop";
    reason: string;
    eligible: boolean;
    metadata?: Record<string, unknown>;
}
/**
 * Pending Question Controller
 */
export declare class PendingQuestionController {
    private questions;
    private currentQuestion;
    private jevDecisionCallback?;
    private userAnswerCallback?;
    private config;
    constructor(config?: {
        evaluationDelayMs?: number;
        jevEnabled?: boolean;
    });
    /**
     * Set callback for Jev decisions
     */
    onJevDecision(callback: (question: PendingQuestion, decision: JevDecision) => void): void;
    /**
     * Set callback for user answers
     */
    onUserAnswer(callback: (question: PendingQuestion, answer: string) => void): void;
    /**
     * Generate unique request ID
     */
    private generateRequestId;
    /**
     * Detect if text contains a question requiring response
     */
    detectQuestion(text: string, _options?: {
        sessionId?: string;
        workspacePath?: string;
        jobId?: string;
    }): DetectionResult;
    /**
     * Check for approval patterns in text without question mark
     * Only triggers if the text is short and looks like a question (no example: prefix)
     */
    private checkApprovalPatterns;
    /**
     * Check if question is quoted or in code block
     */
    private isQuotedOrCode;
    /**
     * Determine question kind
     */
    private determineKind;
    /**
     * Check if it's a routine continuation question
     */
    private isRoutineContinuation;
    /**
     * Create a new pending question
     */
    createQuestion(params: {
        text: string;
        sessionId: string;
        workspacePath: string;
        jobId?: string;
        kind: QuestionKind;
        /** The deterministic risk facts of the proposed action. */
        risk?: {
            requiresExplicitAuthorization?: boolean;
            destructive?: boolean;
            reversible?: boolean;
            external?: boolean;
            signals?: string[];
        };
    }): PendingQuestion;
    /**
     * Get current pending question
     */
    getCurrentQuestion(): PendingQuestion | null;
    /**
     * Check if there's a pending question
     */
    hasPendingQuestion(): boolean;
    /**
     * Update delivery state for a channel
     */
    updateDeliveryState(channel: "telegram" | "line", delivered: boolean, error?: string): void;
    /**
     * Resolve the current question
     * @param params Resolution parameters including optional requestId to validate
     * @returns true if resolved, false if rejected (no question or ID mismatch)
     */
    resolve(params: {
        resolution: "yes" | "no" | "clarification";
        by: ResolutionSource;
        /** Optional requestId to validate (first-answer-wins) */
        requestId?: string;
        /** The channel a human answer came from. */
        channel?: ResolutionChannel;
    }): boolean;
    /**
     * Resolve a question with an autonomous Jev decision.
     *
     * The question is closed with `resolvedBy: "jev"`, the outcome is recorded
     * and the Jev callback is notified. No user answer is dispatched: nobody
     * clicked anything.
     *
     * @returns true if the question was closed, false when it was stale or
     *   already answered by a human.
     */
    resolveByJev(requestId: string, outcome: JevOutcome, reason?: string): boolean;
    /**
     * Apply an approval action from a channel to the current question.
     *
     * The action names are the shared callback actions, so Telegram and LINE
     * use the same values and the same resolver. A stale request ID, a
     * duplicate click or a wrong session leaves the running wait untouched.
     */
    applyApproval(action: string, requestId: string, channel: ResolutionChannel): {
        applied: boolean;
        resolution?: "yes" | "no";
        reason?: string;
    };
    /**
     * Is the request ID still actionable?
     *
     * A button of a closed question is stale: it must not resolve another
     * question and it must not clear a running wait.
     */
    isActionable(requestId: string): boolean;
    /**
     * Cancel the current question (e.g., on session switch)
     */
    cancel(reason?: string): void;
    /**
     * Start Jev evaluation
     */
    startEvaluation(): void;
    /**
     * Get pending question by request ID
     */
    getQuestion(requestId: string): PendingQuestion | undefined;
    /**
     * Get all questions
     */
    getAllQuestions(): PendingQuestion[];
    /**
     * Clean up old resolved questions
     */
    cleanup(maxAgeMs?: number): void;
    /**
     * Check if question is answered
     */
    isResolved(): boolean;
    /**
     * Get resolution
     */
    getResolution(): PendingQuestion["resolution"] | undefined;
    /**
     * Check if should suppress completion
     */
    shouldSuppressCompletion(): boolean;
}
export declare function getPendingQuestionController(): PendingQuestionController;
export declare function createPendingQuestionController(config?: {
    evaluationDelayMs?: number;
    jevEnabled?: boolean;
}): PendingQuestionController;
//# sourceMappingURL=pending-question.d.ts.map