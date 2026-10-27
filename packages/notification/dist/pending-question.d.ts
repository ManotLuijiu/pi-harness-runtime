/**
 * Pending Question Controller
 *
 * Manages pending questions that require human response.
 * Supports multiple channels (Telegram, LINE) and Jev evaluation.
 */
/**
 * Question kinds
 */
export type QuestionKind = "routine" | "approval" | "choice" | "clarification" | "explicit";
/**
 * The typed ask of a detected question.
 *
 * An ask is not the same thing as a question: a question is a sentence, an
 * ask is what the agent wants. The distinction matters after the timeout:
 * an ask of type "choice" can be decided autonomously (the decision names
 * the chosen option), while an ask of type "clarification" or
 * "explicit_authorization" waits for a human.
 *
 * A question the detector cannot interpret is NOT a routine ask: an
 * unrecognized question is a clarification, because the harness does not
 * know what the agent is waiting for and must not guess.
 */
export type AskType = "approval" | "choice" | "clarification" | "explicit_authorization" | "routine";
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
    /** The typed ask of the question. */
    askType?: AskType;
    /** The concrete alternatives of a choice question. */
    alternatives?: string[];
    /** The complete assistant message the question was detected in. */
    contextText?: string;
    /** The option Jev selected for a choice question. */
    selectedOption?: string;
    /** The scope Jev chose for the selected option. */
    scope?: DecisionScope;
    /** The safe reason code of the last state transition. */
    closedReason?: string;
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
    /** The typed ask of the detected question. */
    askType?: AskType;
    /** The concrete alternatives of a choice question. */
    alternatives?: string[];
    /** The complete assistant message the question was detected in. */
    contextText?: string;
}
/**
 * The scope of an autonomous decision.
 *
 * A large or expensive job is not done in one step: the decision may
 * limit itself to a canary that is verified before the work scales up.
 */
export type DecisionScope = "full_scope" | "canary_first" | "none";
/**
 * The structured resolution of an autonomous decision.
 *
 * It is the answer to the question the agent asked: the selected option,
 * the scope and the reasoning. It is never a human answer.
 */
export interface JevResolution {
    /** The option Jev selected for a choice question. */
    selectedOption?: string;
    /** The scope Jev chose. */
    scope?: DecisionScope;
    /** The reasoning of the decision. */
    reasoning?: string;
}
/**
 * Does the message ask for an explicit human authorization?
 *
 * An ask of this kind is never decided autonomously: only the human may
 * authorize it.
 */
export declare function hasExplicitAuthorizationWording(text: string): boolean;
/**
 * The typed ask of a question kind.
 */
export declare function askTypeForKind(kind: QuestionKind): AskType;
/**
 * The typed ask of a detected question.
 *
 * A choice keeps its type: the agent offers concrete alternatives, and a
 * decision may pick one of them. Every other ask that the message
 * explicitly reserves for the human is an explicit authorization.
 */
export declare function computeAskType(kind: QuestionKind, explicitAuthorization: boolean): AskType;
/**
 * Extract the alternatives of a choice question.
 *
 * The result is what the decision has to choose between, so it must be
 * concrete: "the current staging state is intended" is an alternative,
 * "is the current staging state intended?" is not. An empty or unusable
 * half means the question is not a choice after all.
 */
export declare function extractAlternatives(question: string): string[];
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
     *
     * The complete assistant message is kept as the context of the question:
     * the sentence that carries the question often leaves out what the agent
     * is really waiting for ("I need your OK before ..."). The risk facts and
     * the decision are derived from the whole message, not from the sentence
     * alone.
     */
    detectQuestion(text: string, options?: {
        sessionId?: string;
        workspacePath?: string;
        jobId?: string;
        /** The complete assistant message the question was detected in. */
        contextText?: string;
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
        /** The typed ask of the question. */
        askType?: AskType;
        /** The concrete alternatives of a choice question. */
        alternatives?: string[];
        /** The complete assistant message the question was detected in. */
        contextText?: string;
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
    resolveByJev(requestId: string, outcome: JevOutcome, reason?: string, resolution?: JevResolution): boolean;
    /**
     * Expire the pending question when the decision deadline is reached.
     *
     * The deadline is a terminal path: the question is closed with the safe
     * reason code, the buttons of that request become stale, and the wait
     * state is cleared. A question that is left open here looks like a
     * request that is still waiting - forever.
     *
     * @returns true if the question was expired, false when it was already
     *   answered by a human or closed by a decision.
     */
    expireByTimeout(requestId: string, reason?: string): boolean;
    /**
     * The state of the current question.
     */
    getState(): QuestionState | undefined;
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