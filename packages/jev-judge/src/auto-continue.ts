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
import type { JevJudgeConfig, JevEvaluationResult } from "./types.js";
import { logError } from "./file-logger.js";

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
export type DecisionOutcome =
  | "approve"
  | "reject"
  | "wait"
  | "proceed_with_caution";

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
export const MAX_LISTED_TASKS = 10;
/** How much of the question text reaches the evaluation. */
export const MAX_QUESTION_CHARS = 2000;

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

export function applyDecisionPolicy(
  proposed: DecisionOutcome,
  context: DecisionContext | undefined,
  options?: DecisionPolicyOptions,
): DecisionPolicyResult {
  const question = context?.question;

  if (proposed === "approve" || proposed === "proceed_with_caution") {
    if (question?.kind === "clarification") {
      return {
        outcome: "wait",
        appliedRule: "clarification-never-approved",
        reason:
          "A clarification asks which option is meant. Guessing it would decide for the user.",
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

    const threshold = options?.confidenceThreshold ?? 0.7;
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
export function decideOutcomeApplication(
  outcome: DecisionOutcome,
  requestClosed: boolean,
): OutcomeApplication {
  if (outcome === "wait") return "wait";
  if (!requestClosed) return "discard";
  return outcome === "reject" ? "pause" : "continue";
}

/**
 * Auto-continue decision
 */
export interface AutoContinueDecision {
  action: "proceed" | "wait" | "proceed_with_caution";
  /** The typed outcome after the policy was applied. */
  outcome: DecisionOutcome;
  probability: number; // 0-1 confidence to proceed
  riskLevel: "minimal" | "low" | "medium" | "high" | "critical";
  reasoning: string;
  urgency: "critical" | "high" | "normal" | "low";
  estimatedImpact: "minimal" | "moderate" | "significant" | "major";
  confidence: "high" | "medium" | "low";
  waitRecommendation?: number; // minutes to wait if action is "wait"
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
 * Default configuration
 */
const DEFAULT_CONFIG = {
  proceedThreshold: 0.7,
  cautionThreshold: 0.5,
  maxWaitMinutes: 30,
  fallbackAction: "wait" as const,
};

/**
 * Auto-Continue Judge
 *
 * Judges whether an agent should continue autonomously when user is unavailable.
 * Integrates with pi-coding-agent hooks for automatic decision making.
 */
export class AutoContinueJudge {
  private jev: JevJudge;
  private config: Required<AutoContinueConfig>;

  constructor(config: AutoContinueConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<AutoContinueConfig>;

    this.jev = new JevJudge(config);
  }

  /**
   * Judge whether to continue or wait
   */
  async decide(
    taskState: TaskState
  ): Promise<AutoContinueDecision> {
    const state = this.buildState(taskState);

    try {
      const result = await this.jev.evaluate(state, {
        shouldProceed: {
          type: "noul",
          instructions:
            "The agent should continue with remaining tasks without waiting for user confirmation. Consider: task completion %, risk of wrong action, time sensitivity, user unavailability.",
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
          instructions:
            "Would waiting for user confirmation significantly improve the outcome or prevent a serious mistake?",
        },
        taskComplexity: {
          type: "score",
          instructions:
            "How complex are the remaining tasks compared to completed ones?",
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
    } catch (error) {
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
  private applyPolicy(
    decision: AutoContinueDecision,
    taskState: TaskState,
  ): AutoContinueDecision {
    const policy = applyDecisionPolicy(decision.outcome, taskState.context, {
      confidenceThreshold: this.config.proceedThreshold,
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

    return decision;
  }

  /**
   * Quick decision - simple yes/no to proceed
   */
  async shouldContinue(
    taskState: TaskState
  ): Promise<{ shouldContinue: boolean; probability: number; confidence: string }> {
    const result = await this.decide(taskState);

    return {
      shouldContinue: result.action !== "wait",
      probability: result.probability,
      confidence: result.confidence,
    };
  }

  /**
   * Build state for Jev
   */
  private buildState(taskState: TaskState): string {
    return JSON.stringify(buildDecisionState(taskState), null, 2);
  }

  /**
   * Build decision from Jev result
   */
  private buildDecision(
    result: JevEvaluationResult,
    _taskState: TaskState
  ): AutoContinueDecision {
    const shouldProceed = result.decisions.shouldProceed;
    const probability = shouldProceed.probability ?? 0.5;

    const riskDecision = result.decisions.riskLevel;
    const riskScore = (riskDecision?.response as { score: number })?.score ?? 3;
    const riskLevel = this.scoreToRiskLevel(riskScore);

    const urgencyDecision = result.decisions.urgency as {
      response: { choice: string };
    };
    const urgency = (urgencyDecision?.response?.choice as AutoContinueDecision["urgency"]) ?? "normal";

    const impactDecision = result.decisions.estimatedImpact as {
      response: { choice: string };
    };
    const estimatedImpact = (impactDecision?.response?.choice as AutoContinueDecision["estimatedImpact"]) ?? "moderate";

    const waitBenefit = (result.decisions.waitBenefit?.response as { noul: number })?.noul ?? 0.5;

    // Determine action based on thresholds
    let action: AutoContinueDecision["action"];
    let confidence: AutoContinueDecision["confidence"];
    let reasoning: string;

    if (probability >= this.config.proceedThreshold) {
      action = "proceed";
      confidence = probability > 0.85 ? "high" : "medium";
      reasoning = `High confidence to proceed (${(probability * 100).toFixed(0)}%)`;
    } else if (probability >= this.config.cautionThreshold && riskScore <= 3) {
      action = "proceed_with_caution";
      confidence = "medium";
      reasoning = `Proceed with caution (${(probability * 100).toFixed(0)}%), risk level ${riskScore}/5`;
    } else if (waitBenefit < 0.3 && riskScore <= 2) {
      action = "proceed_with_caution";
      confidence = "low";
      reasoning = `Low wait benefit, proceeding despite lower confidence`;
    } else {
      action = "wait";
      confidence = "high";
      reasoning = `Waiting recommended (${((1 - probability) * 100).toFixed(0)}% confidence to wait)`;
    }

    // Calculate recommended wait time
    let waitRecommendation: number | undefined;
    if (action === "wait") {
      waitRecommendation = Math.min(
        this.config.maxWaitMinutes,
        Math.round(this.config.maxWaitMinutes * (1 - probability))
      );
    }

    return {
      action,
      outcome:
        action === "proceed"
          ? "approve"
          : action === "proceed_with_caution"
            ? "proceed_with_caution"
            : "wait",
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
  private scoreToRiskLevel(score: number): AutoContinueDecision["riskLevel"] {
    if (score <= 1.5) return "minimal";
    if (score <= 2.5) return "low";
    if (score <= 3.5) return "medium";
    if (score <= 4.5) return "high";
    return "critical";
  }

  /**
   * Fallback decision when Jev fails
   */
  private fallbackDecision(taskState: TaskState): AutoContinueDecision {
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
export function isEligibleForDecision(
  waitedMinutes: number,
  minWaitMinutes: number
): boolean {
  return waitedMinutes >= minWaitMinutes;
}

/**
 * The bounded evaluation input of a decision.
 *
 * It carries the question Jev has to decide about, the risk of the proposed
 * action and the relevant task state - and nothing that grows without a
 * bound.
 */
export function buildDecisionState(taskState: TaskState): Record<string, unknown> {
  const completionPercent = Math.round(
    (taskState.completedTasks.length / taskState.totalTasks) * 100
  );

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
      session_duration_minutes: Math.round(
        (Date.now() - taskState.sessionStartTime.getTime()) / 60000
      ),
    },
    // The question Jev decides about. Without it Jev only sees progress.
    pending_question: question
      ? {
          request_id: question.requestId,
          kind: question.kind,
          text: question.text.slice(0, MAX_QUESTION_CHARS),
          proposed_action: question.proposedAction ?? "unknown",
          consequence_of_approval: question.consequence ?? "unknown",
          requires_explicit_authorization:
            question.requiresExplicitAuthorization ?? false,
          destructive: question.destructive ?? false,
          external_effect: question.external ?? false,
          reversible: question.reversible ?? true,
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
export function createTaskState(
  completedTasks: string[],
  remainingTasks: string[],
  lastUserActivity?: Date,
  sessionStartTime?: Date,
  context?: DecisionContext
): TaskState {
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
