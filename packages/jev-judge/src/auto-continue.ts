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
}

/**
 * Auto-continue decision
 */
export interface AutoContinueDecision {
  action: "proceed" | "wait" | "proceed_with_caution";
  probability: number; // 0-1 confidence to proceed
  riskLevel: "minimal" | "low" | "medium" | "high" | "critical";
  reasoning: string;
  urgency: "critical" | "high" | "normal" | "low";
  estimatedImpact: "minimal" | "moderate" | "significant" | "major";
  confidence: "high" | "medium" | "low";
  waitRecommendation?: number; // minutes to wait if action is "wait"
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
        },
        urgency: {
          type: "choice",
          instructions: "How urgent are the remaining tasks?",
          options: ["critical", "high", "normal", "low"],
        },
        estimatedImpact: {
          type: "choice",
          instructions: "Impact if the agent makes wrong decision by proceeding",
          options: ["minimal", "moderate", "significant", "major"],
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
        },
      });

      return this.buildDecision(result, taskState);
    } catch (error) {
      console.error("[AutoContinueJudge] Jev call failed:", error);
      return this.fallbackDecision(taskState);
    }
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
    const completionPercent = Math.round(
      (taskState.completedTasks.length / taskState.totalTasks) * 100
    );

    const state = {
      task_summary: {
        completed: taskState.completedTasks.length,
        remaining: taskState.remainingTasks.length,
        total: taskState.totalTasks,
        completion_percent: completionPercent,
        completed_list: taskState.completedTasks,
        remaining_list: taskState.remainingTasks,
      },
      user_status: {
        responded: taskState.userResponded,
        wait_time_minutes: taskState.waitTimeMinutes,
        last_activity: taskState.lastUserActivity?.toISOString() ?? "unknown",
        session_duration_minutes: Math.round(
          (Date.now() - taskState.sessionStartTime.getTime()) / 60000
        ),
      },
    };

    return JSON.stringify(state, null, 2);
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
 * Helper: Create task state from todo list
 */
export function createTaskState(
  completedTasks: string[],
  remainingTasks: string[],
  lastUserActivity?: Date,
  sessionStartTime?: Date
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
  };
}
