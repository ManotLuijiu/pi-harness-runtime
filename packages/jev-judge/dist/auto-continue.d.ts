/**
 * Auto-Continue Judge - Agent decision making when user is unavailable
 *
 * Uses Jev to decide whether an agent should continue autonomously
 * when waiting for user input that may not come.
 *
 * Scenario: Agent completes 2/5 tasks, asks "Continue?" User asleep.
 * Jev decides: proceed, wait, or proceed with caution.
 */
import type { JevJudgeConfig } from "./types.js";
/**
 * Task tracking state
 */
export interface TaskState {
    completedTasks: string[];
    remainingTasks: string[];
    totalTasks: number;
    waitTimeMinutes: number;
    userResponded: boolean;
    lastUserActivity?: Date;
    sessionStartTime: Date;
    /** The bounded decision context (question, risk, task state). */
    context?: DecisionContext;
}
/**
 * The typed outcome of a decision.
 *
 * It is not the same shape as a human answer: an autonomous decision is
 * never reported as a user "yes".
 */
export type DecisionOutcome = "approve" | "reject" | "wait" | "proceed_with_caution";
/**
 * The pending question Jev has to decide about.
 *
 * Without it Jev can only see progress, not what the agent asked permission
 * to do.
 */
export interface PendingQuestionContext {
    /** The canonical request ID. */
    requestId: string;
    /** The complete question text. */
    text: string;
    /** The detected kind of the question. */
    kind: "routine" | "approval" | "clarification" | "explicit";
    /** The exact action the agent proposes. */
    proposedAction?: string;
    /** What happens when the question is approved. */
    consequence?: string;
    /** Does the action need an explicit human authorization? */
    requiresExplicitAuthorization?: boolean;
    /** Does the action destroy or overwrite something? */
    destructive?: boolean;
    /** Does the action leave the machine (network, mail, deploy)? */
    external?: boolean;
    /** Can the action be undone? */
    reversible?: boolean;
}
/**
 * The bounded context of a decision.
 *
 * Everything is bounded on purpose: an unbounded todo transcript makes the
 * evaluation input large and expensive without making it better.
 */
export interface DecisionContext {
    question?: PendingQuestionContext;
    /** The task the session is working on right now. */
    currentTask?: string;
    /** 0..1 */
    completionRatio?: number;
    totalTasks?: number;
    completedTasks?: number;
    /** What blocks the work. */
    blockers?: string[];
    /** The next relevant tasks. */
    nextTasks?: string[];
    /** The state of the last validation run. */
    validationStatus?: string;
    /** How long the question is already waiting. */
    waitedMinutes?: number;
    /** When the decision has to be made. */
    deadlineMinutes?: number;
    /** When the user was last active. */
    lastUserActivity?: Date;
}
/** How many task titles reach the evaluation. */
export declare const MAX_LISTED_TASKS = 10;
/** How much of the question text reaches the evaluation. */
export declare const MAX_QUESTION_CHARS = 2000;
/**
 * The deterministic part of a decision.
 *
 * Jev proposes an outcome, this function decides what is actually allowed.
 * The rules live in code and not in a prompt: a clarification is never
 * turned into an approval of a guessed interpretation, and an action that
 * needs an explicit human authorization or that cannot be undone is never
 * approved autonomously.
 */
export interface DecisionPolicyResult {
    outcome: DecisionOutcome;
    /** The rule that changed the outcome, when one did. */
    appliedRule?: string;
    reason: string;
}
export interface DecisionPolicyOptions {
    /** The confidence an autonomous approval needs. */
    confidenceThreshold?: number;
    /** The confidence of the proposed outcome. */
    confidence?: number;
}
/**
 * Is the value a known outcome?
 *
 * The evaluation returns the outcome as a free-text choice: an unknown
 * value is ignored instead of being guessed.
 */
export declare function isDecisionOutcome(value: unknown): value is DecisionOutcome;
/**
 * Combine the threshold outcome with the structured outcome of the
 * evaluation.
 *
 * The evaluation may only tighten the decision: a rejection stays a
 * rejection, a wait stays a wait, and an approval never beats the
 * thresholds.
 */
export declare function tightenOutcome(thresholdOutcome: DecisionOutcome, proposed: DecisionOutcome | undefined): DecisionOutcome;
/**
 * Are the risk facts of the proposed action unknown?
 *
 * A question without a kind and without a single known risk fact cannot be
 * judged: the policy waits for the human instead of continuing on a guess.
 */
export declare function hasUnknownRiskFacts(question: PendingQuestionContext): boolean;
export declare function applyDecisionPolicy(proposed: DecisionOutcome, context: DecisionContext | undefined, options?: DecisionPolicyOptions): DecisionPolicyResult;
/**
 * What the runtime does with a Jev outcome.
 *
 * - `continue`: the work resumes with a steer to the agent.
 * - `pause`: the work stops and waits for a human.
 * - `discard`: the decision was stale and must not change anything.
 * - `wait`: the question stays open for a later decision.
 */
export type OutcomeApplication = "continue" | "pause" | "discard" | "wait";
/**
 * Decide what a Jev outcome means for the running work.
 *
 * `requestClosed` tells whether the pending question was still open and
 * could be closed with the Jev decision. A closed question is the only
 * proof that nobody answered in the meantime: when the request was already
 * answered by a human the Jev decision is stale, and a stale decision must
 * never continue the work.
 *
 * The rule is deterministic: only a successfully closed request may continue
 * or pause the work, and a rejection never continues it.
 */
export declare function decideOutcomeApplication(outcome: DecisionOutcome, requestClosed: boolean): OutcomeApplication;
/**
 * Auto-continue decision
 */
export interface AutoContinueDecision {
    action: "proceed" | "wait" | "proceed_with_caution" | "reject";
    /** The typed outcome after the policy was applied. */
    outcome: DecisionOutcome;
    probability: number;
    riskLevel: "minimal" | "low" | "medium" | "high" | "critical";
    reasoning: string;
    urgency: "critical" | "high" | "normal" | "low";
    estimatedImpact: "minimal" | "moderate" | "significant" | "major";
    confidence: "high" | "medium" | "low";
    waitRecommendation?: number;
    /** The policy rule that changed the outcome, when one did. */
    policyApplied?: string;
}
/**
 * Auto-Continue Judge configuration
 */
export interface AutoContinueConfig extends JevJudgeConfig {
    /** Minimum probability to auto-proceed (default: 0.7) */
    proceedThreshold?: number;
    /** Minimum probability to proceed with caution (default: 0.5) */
    cautionThreshold?: number;
    /** Maximum wait time before force decision (default: 30 minutes) */
    maxWaitMinutes?: number;
    /** Default action if Jev fails (default: "wait") */
    fallbackAction?: "proceed" | "wait" | "proceed_with_caution";
}
/**
 * Auto-Continue Judge
 *
 * Judges whether an agent should continue autonomously when user is unavailable.
 * Integrates with pi-coding-agent hooks for automatic decision making.
 */
export declare class AutoContinueJudge {
    private jev;
    private config;
    constructor(config: AutoContinueConfig);
    /**
     * Judge whether to continue or wait
     */
    decide(taskState: TaskState): Promise<AutoContinueDecision>;
    /**
     * Apply the deterministic policy to a proposed decision.
     *
     * The policy is code, not a prompt: it decides what is actually allowed,
     * and it records which rule changed the outcome.
     */
    private applyPolicy;
    /**
     * Quick decision - simple yes/no to proceed
     */
    shouldContinue(taskState: TaskState): Promise<{
        shouldContinue: boolean;
        probability: number;
        confidence: string;
    }>;
    /**
     * Build state for Jev
     */
    private buildState;
    /**
     * Build decision from Jev result
     */
    private buildDecision;
    /**
     * Convert score to risk level
     */
    private scoreToRiskLevel;
    /**
     * Fallback decision when Jev fails
     */
    private fallbackDecision;
}
/**
 * Is the question old enough for an autonomous decision?
 *
 * The threshold belongs to the caller: the judge is only asked once the
 * question waited long enough.
 */
export declare function isEligibleForDecision(waitedMinutes: number, minWaitMinutes: number): boolean;
/**
 * The bounded evaluation input of a decision.
 *
 * It carries the question Jev has to decide about, the risk of the proposed
 * action and the relevant task state - and nothing that grows without a
 * bound.
 */
export declare function buildDecisionState(taskState: TaskState): Record<string, unknown>;
/**
 * Helper: Create task state from todo list
 */
export declare function createTaskState(completedTasks: string[], remainingTasks: string[], lastUserActivity?: Date, sessionStartTime?: Date, context?: DecisionContext): TaskState;
//# sourceMappingURL=auto-continue.d.ts.map