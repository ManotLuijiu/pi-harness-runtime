/**
 * Auto-Continue Judge - Agent decision making when user is unavailable
 *
 * Uses Jev to decide whether an agent should continue autonomously
 * when waiting for user input that may not come.
 *
 * Scenario: Agent completes 2/5 tasks, asks "Continue?" User asleep.
 * Jev decides: proceed, wait, or proceed with caution.
 */
import { JevJudge } from "./index.js";
import { logError } from "./file-logger.js";
/** How many task titles reach the evaluation. */
export const MAX_LISTED_TASKS = 10;
/** How much of the question text reaches the evaluation. */
export const MAX_QUESTION_CHARS = 2000;
/** The confidence an autonomous approval needs by default. */
export const DEFAULT_PROCEED_THRESHOLD = 0.7;
/** The confidence a cautious approval needs by default. */
export const DEFAULT_CAUTION_THRESHOLD = 0.5;
/**
 * Is the value a known outcome?
 *
 * The evaluation returns the outcome as a free-text choice: an unknown
 * value is ignored instead of being guessed.
 */
export function isDecisionOutcome(value) {
    return (value === "approve" ||
        value === "reject" ||
        value === "wait" ||
        value === "proceed_with_caution");
}
/**
 * Combine the threshold outcome with the structured outcome of the
 * evaluation.
 *
 * The evaluation may only tighten the decision: a rejection stays a
 * rejection, a wait stays a wait, and an approval never beats the
 * thresholds.
 */
export function tightenOutcome(thresholdOutcome, proposed) {
    if (!proposed)
        return thresholdOutcome;
    if (proposed === "reject")
        return "reject";
    if (proposed === "wait")
        return "wait";
    if (proposed === "proceed_with_caution") {
        return thresholdOutcome === "approve" ? "proceed_with_caution" : thresholdOutcome;
    }
    // The evaluation proposed an approval: the thresholds keep their veto.
    return thresholdOutcome === "wait" ? "wait" : thresholdOutcome;
}
/**
 * Are the risk facts of the proposed action unknown?
 *
 * A question without a kind and without a single known risk fact cannot be
 * judged: the policy waits for the human instead of continuing on a guess.
 */
export function hasUnknownRiskFacts(question) {
    if (!question.kind)
        return true;
    return (question.requiresExplicitAuthorization === undefined &&
        question.destructive === undefined &&
        question.reversible === undefined);
}
export function applyDecisionPolicy(proposed, context, options) {
    const question = context?.question;
    if (proposed === "approve" || proposed === "proceed_with_caution") {
        if (question?.kind === "clarification") {
            return {
                outcome: "wait",
                appliedRule: "clarification-never-approved",
                reason: "A clarification asks which option is meant. Guessing it would decide for the user.",
            };
        }
        if (question?.requiresExplicitAuthorization) {
            return {
                outcome: "wait",
                appliedRule: "explicit-authorization-required",
                reason: "The action needs an explicit human authorization.",
            };
        }
        if (question?.destructive && question.reversible === false) {
            return {
                outcome: "wait",
                appliedRule: "irreversible-action",
                reason: "The action cannot be undone, so it waits for the user.",
            };
        }
        if (question?.destructive) {
            return {
                outcome: "proceed_with_caution",
                appliedRule: "destructive-action",
                reason: "The action is destructive but reversible, so it proceeds with caution.",
            };
        }
        // Nothing is known about the risk of the action: an uncertain case
        // waits for the human instead of continuing on a guess.
        if (question && hasUnknownRiskFacts(question)) {
            return {
                outcome: "wait",
                appliedRule: "unknown-risk-facts",
                reason: "The risk of the proposed action is unknown, so it waits for the user.",
            };
        }
        // The threshold belongs to the outcome: a cautious approval needs the
        // caution threshold, the higher approval threshold is reserved for a
        // full approval. The configured caution range must really proceed.
        const threshold = proposed === "proceed_with_caution"
            ? (options?.cautionThreshold ?? DEFAULT_CAUTION_THRESHOLD)
            : (options?.confidenceThreshold ?? DEFAULT_PROCEED_THRESHOLD);
        const confidence = options?.confidence;
        if (typeof confidence === "number" && confidence < threshold) {
            return {
                outcome: "wait",
                appliedRule: "confidence-below-threshold",
                reason: `The confidence ${confidence.toFixed(2)} is below the threshold ${threshold.toFixed(2)}.`,
            };
        }
    }
    return { outcome: proposed, reason: "No policy rule applied." };
}
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
export function decideOutcomeApplication(outcome, requestClosed) {
    if (outcome === "wait")
        return "wait";
    if (!requestClosed)
        return "discard";
    return outcome === "reject" ? "pause" : "continue";
}
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    proceedThreshold: DEFAULT_PROCEED_THRESHOLD,
    cautionThreshold: DEFAULT_CAUTION_THRESHOLD,
    maxWaitMinutes: 30,
    fallbackAction: "wait",
};
/**
 * Auto-Continue Judge
 *
 * Judges whether an agent should continue autonomously when user is unavailable.
 * Integrates with pi-coding-agent hooks for automatic decision making.
 */
export class AutoContinueJudge {
    jev;
    config;
    constructor(config) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
        };
        this.jev = new JevJudge(config);
    }
    /**
     * Judge whether to continue or wait
     */
    async decide(taskState) {
        const state = this.buildState(taskState);
        try {
            const result = await this.jev.evaluate(state, {
                outcome: {
                    type: "choice",
                    instructions: "The decision for the pending question. Reject it when the proposed action must not happen.",
                    options: ["approve", "proceed_with_caution", "wait", "reject"],
                    optionDescriptions: {
                        approve: "the agent may continue with the planned work",
                        proceed_with_caution: "the agent may continue, but reports every significant step",
                        wait: "keep waiting for the user, the question stays open",
                        reject: "the proposed action must not happen, the work pauses",
                    },
                },
                shouldProceed: {
                    type: "noul",
                    instructions: "The agent should continue with remaining tasks without waiting for user confirmation. Consider: task completion %, risk of wrong action, time sensitivity, user unavailability.",
                },
                riskLevel: {
                    type: "score",
                    instructions: "Risk level if agent proceeds without user confirmation",
                    min: 1,
                    max: 5,
                    criteria: [
                        "1 - minimal risk, nothing can go wrong",
                        "2 - low risk, easily reversible",
                        "3 - moderate risk, partly reversible",
                        "4 - high risk, hard to reverse",
                        "5 - severe risk, irreversible damage possible",
                    ],
                },
                urgency: {
                    type: "choice",
                    instructions: "How urgent are the remaining tasks?",
                    options: ["critical", "high", "normal", "low"],
                    optionDescriptions: {
                        critical: "must be handled right now, everything else waits",
                        high: "should be handled today",
                        normal: "should be handled within the current work cycle",
                        low: "can wait until the current work cycle is done",
                    },
                },
                estimatedImpact: {
                    type: "choice",
                    instructions: "Impact if the agent makes wrong decision by proceeding",
                    options: ["minimal", "moderate", "significant", "major"],
                    optionDescriptions: {
                        minimal: "a small amount of extra work",
                        moderate: "noticeable rework, still contained",
                        significant: "substantial rework or lost work",
                        major: "irreversible loss, data loss or a broken system",
                    },
                },
                waitBenefit: {
                    type: "noul",
                    instructions: "Would waiting for user confirmation significantly improve the outcome or prevent a serious mistake?",
                },
                taskComplexity: {
                    type: "score",
                    instructions: "How complex are the remaining tasks compared to completed ones?",
                    min: 1,
                    max: 5,
                    criteria: [
                        "1 - trivial, a single mechanical step",
                        "2 - simple, a few well known steps",
                        "3 - moderate, some design decisions needed",
                        "4 - complex, many interacting parts",
                        "5 - very complex, unknown territory",
                    ],
                },
            });
            return this.applyPolicy(this.buildDecision(result, taskState), taskState);
        }
        catch (error) {
            logError("[AutoContinueJudge]", `Jev call failed: ${error}`);
            return this.applyPolicy(this.fallbackDecision(taskState), taskState);
        }
    }
    /**
     * Apply the deterministic policy to a proposed decision.
     *
     * The policy is code, not a prompt: it decides what is actually allowed,
     * and it records which rule changed the outcome.
     */
    applyPolicy(decision, taskState) {
        const policy = applyDecisionPolicy(decision.outcome, taskState.context, {
            confidenceThreshold: this.config.proceedThreshold,
            cautionThreshold: this.config.cautionThreshold,
            confidence: decision.probability,
        });
        decision.outcome = policy.outcome;
        if (policy.appliedRule) {
            decision.policyApplied = policy.appliedRule;
            decision.reasoning = `${decision.reasoning} - ${policy.reason}`;
        }
        if (policy.outcome === "wait" && decision.action !== "wait") {
            decision.action = "wait";
            decision.waitRecommendation =
                decision.waitRecommendation ?? this.config.maxWaitMinutes;
        }
        if (policy.outcome === "proceed_with_caution" && decision.action === "proceed") {
            decision.action = "proceed_with_caution";
        }
        // A rejection is never downgraded: the work pauses and waits for a
        // human.
        if (policy.outcome === "reject") {
            decision.action = "reject";
        }
        return decision;
    }
    /**
     * Quick decision - simple yes/no to proceed
     */
    async shouldContinue(taskState) {
        const result = await this.decide(taskState);
        return {
            shouldContinue: result.action === "proceed" || result.action === "proceed_with_caution",
            probability: result.probability,
            confidence: result.confidence,
        };
    }
    /**
     * Build state for Jev
     */
    buildState(taskState) {
        return JSON.stringify(buildDecisionState(taskState), null, 2);
    }
    /**
     * Build decision from Jev result
     */
    buildDecision(result, _taskState) {
        const shouldProceed = result.decisions.shouldProceed;
        const probability = shouldProceed.probability ?? 0.5;
        const riskDecision = result.decisions.riskLevel;
        const riskScore = riskDecision?.response?.score ?? 3;
        const riskLevel = this.scoreToRiskLevel(riskScore);
        const urgencyDecision = result.decisions.urgency;
        const urgency = urgencyDecision?.response?.choice ?? "normal";
        const impactDecision = result.decisions.estimatedImpact;
        const estimatedImpact = impactDecision?.response?.choice ?? "moderate";
        const waitBenefit = result.decisions.waitBenefit?.response?.noul ?? 0.5;
        // The structured outcome of the evaluation. It can make the decision
        // stricter (reject, wait) but never looser than the thresholds allow.
        const outcomeChoice = result.decisions.outcome?.response?.choice;
        const proposedOutcome = isDecisionOutcome(outcomeChoice)
            ? outcomeChoice
            : undefined;
        // Determine action based on thresholds
        let action;
        let confidence;
        let reasoning;
        if (probability >= this.config.proceedThreshold) {
            action = "proceed";
            confidence = probability > 0.85 ? "high" : "medium";
            reasoning = `High confidence to proceed (${(probability * 100).toFixed(0)}%)`;
        }
        else if (probability >= this.config.cautionThreshold && riskScore <= 3) {
            action = "proceed_with_caution";
            confidence = "medium";
            reasoning = `Proceed with caution (${(probability * 100).toFixed(0)}%), risk level ${riskScore}/5`;
        }
        else if (waitBenefit < 0.3 && riskScore <= 2) {
            action = "proceed_with_caution";
            confidence = "low";
            reasoning = `Low wait benefit, proceeding despite lower confidence`;
        }
        else {
            action = "wait";
            confidence = "high";
            reasoning = `Waiting recommended (${((1 - probability) * 100).toFixed(0)}% confidence to wait)`;
        }
        let outcome = action === "proceed"
            ? "approve"
            : action === "proceed_with_caution"
                ? "proceed_with_caution"
                : "wait";
        // The outcome of the evaluation may only tighten the decision: a
        // rejection stays a rejection, a wait stays a wait, and an approval
        // never beats the thresholds.
        outcome = tightenOutcome(outcome, proposedOutcome);
        if (outcome === "reject") {
            action = "reject";
            confidence = probability > 0.85 ? "high" : "medium";
            reasoning = `Jev rejected the proposed action (${(probability * 100).toFixed(0)}% confidence to proceed)`;
        }
        else if (outcome === "wait" && proposedOutcome === "wait") {
            action = "wait";
            reasoning = "Jev decided to wait for the user";
        }
        else if (outcome === "proceed_with_caution" && proposedOutcome === "proceed_with_caution") {
            action = "proceed_with_caution";
        }
        else if (proposedOutcome === "approve" && outcome === "wait") {
            // The thresholds keep their veto: a low confidence stays a wait.
            reasoning = `${reasoning} - Jev proposed an approval, the confidence stays below the threshold`;
        }
        // Calculate recommended wait time
        let waitRecommendation;
        if (action === "wait") {
            waitRecommendation = Math.min(this.config.maxWaitMinutes, Math.round(this.config.maxWaitMinutes * (1 - probability)));
        }
        return {
            action,
            outcome,
            probability,
            riskLevel,
            reasoning,
            urgency,
            estimatedImpact,
            confidence,
            waitRecommendation,
        };
    }
    /**
     * Convert score to risk level
     */
    scoreToRiskLevel(score) {
        if (score <= 1.5)
            return "minimal";
        if (score <= 2.5)
            return "low";
        if (score <= 3.5)
            return "medium";
        if (score <= 4.5)
            return "high";
        return "critical";
    }
    /**
     * Fallback decision when Jev fails
     */
    fallbackDecision(taskState) {
        const completionPercent = taskState.completedTasks.length / taskState.totalTasks;
        // If >80% done and waited >15 min, proceed with caution
        if (completionPercent >= 0.8 && taskState.waitTimeMinutes >= 15) {
            return {
                action: "proceed_with_caution",
                outcome: "proceed_with_caution",
                probability: 0.6,
                riskLevel: "medium",
                reasoning: "Fallback: high completion, waited long time",
                urgency: "normal",
                estimatedImpact: "moderate",
                confidence: "low",
                waitRecommendation: 10,
            };
        }
        return {
            action: this.config.fallbackAction,
            outcome: "wait",
            probability: 0.5,
            riskLevel: "medium",
            reasoning: "Fallback: Jev unavailable, using default behavior",
            urgency: "normal",
            estimatedImpact: "moderate",
            confidence: "low",
            waitRecommendation: this.config.maxWaitMinutes,
        };
    }
}
/**
 * Is the question old enough for an autonomous decision?
 *
 * The threshold belongs to the caller: the judge is only asked once the
 * question waited long enough.
 */
export function isEligibleForDecision(waitedMinutes, minWaitMinutes) {
    return waitedMinutes >= minWaitMinutes;
}
/**
 * The bounded evaluation input of a decision.
 *
 * It carries the question Jev has to decide about, the risk of the proposed
 * action and the relevant task state - and nothing that grows without a
 * bound.
 */
export function buildDecisionState(taskState) {
    const completionPercent = Math.round((taskState.completedTasks.length / taskState.totalTasks) * 100);
    const context = taskState.context;
    const question = context?.question;
    return {
        task_summary: {
            completed: taskState.completedTasks.length,
            remaining: taskState.remainingTasks.length,
            total: taskState.totalTasks,
            completion_percent: completionPercent,
            // Bounded: the evaluation input stays small, the most recent
            // completions and the first remaining tasks are the relevant ones.
            completed_list: taskState.completedTasks.slice(-MAX_LISTED_TASKS),
            remaining_list: taskState.remainingTasks.slice(0, MAX_LISTED_TASKS),
        },
        user_status: {
            responded: taskState.userResponded,
            wait_time_minutes: taskState.waitTimeMinutes,
            last_activity: taskState.lastUserActivity?.toISOString() ?? "unknown",
            session_duration_minutes: Math.round((Date.now() - taskState.sessionStartTime.getTime()) / 60000),
        },
        // The question Jev decides about. Without it Jev only sees progress.
        pending_question: question
            ? {
                request_id: question.requestId,
                kind: question.kind,
                text: question.text.slice(0, MAX_QUESTION_CHARS),
                proposed_action: question.proposedAction ?? "unknown",
                consequence_of_approval: question.consequence ?? "unknown",
                // The risk facts are unknown when they were not determined: an
                // unknown fact is reported as unknown and never as "harmless".
                requires_explicit_authorization: question.requiresExplicitAuthorization ?? "unknown",
                destructive: question.destructive ?? "unknown",
                external_effect: question.external ?? "unknown",
                reversible: question.reversible ?? "unknown",
            }
            : null,
        decision_context: {
            current_task: context?.currentTask ?? "unknown",
            completion_ratio: context?.completionRatio ?? completionPercent / 100,
            blockers: (context?.blockers ?? []).slice(0, MAX_LISTED_TASKS),
            next_tasks: (context?.nextTasks ?? []).slice(0, MAX_LISTED_TASKS),
            validation_status: context?.validationStatus ?? "unknown",
            waited_minutes: context?.waitedMinutes ?? taskState.waitTimeMinutes,
            deadline_minutes: context?.deadlineMinutes ?? null,
        },
    };
}
/**
 * Helper: Create task state from todo list
 */
export function createTaskState(completedTasks, remainingTasks, lastUserActivity, sessionStartTime, context) {
    const totalTasks = completedTasks.length + remainingTasks.length;
    return {
        completedTasks,
        remainingTasks,
        totalTasks,
        waitTimeMinutes: lastUserActivity
            ? Math.round((Date.now() - lastUserActivity.getTime()) / 60000)
            : 0,
        userResponded: false,
        lastUserActivity,
        sessionStartTime: sessionStartTime ?? new Date(),
        context,
    };
}
//# sourceMappingURL=auto-continue.js.map