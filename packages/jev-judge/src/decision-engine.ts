/**
 * Decision Engine - Threshold-based routing and action decisions
 *
 * Wraps Jev decisions with configurable thresholds for automated actions.
 */

import { JevJudge } from "./index.js";
import type { JevJudgeConfig, ThresholdDecision } from "./types.js";

/**
 * Threshold configuration for automatic decisions
 */
export interface ThresholdConfig {
  /** Threshold for automatic approval (default: 0.9) */
  approval?: number;
  /** Threshold for requiring review (default: 0.5) */
  review?: number;
  /** Threshold for automatic blocking (default: 0.2) */
  block?: number;
  /** Custom thresholds per question ID */
  perQuestion?: Record<string, { approval?: number; review?: number; block?: number }>;
}

/**
 * Action result from the decision engine
 */
export interface ActionResult {
  action: "proceed" | "review" | "block";
  shouldAct: boolean;
  probability: number;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Decision Engine - Makes automated decisions based on Jev probabilities
 */
export class DecisionEngine {
  private judge: JevJudge;
  private defaultThresholds: ThresholdConfig;

  constructor(
    config: JevJudgeConfig,
    thresholds?: ThresholdConfig
  ) {
    this.judge = new JevJudge(config);
    this.defaultThresholds = {
      approval: 0.9,
      review: 0.5,
      block: 0.2,
      ...thresholds,
    };
  }

  /**
   * Decide action based on probability and thresholds
   */
  decide(
    probability: number,
    thresholds?: ThresholdConfig
  ): ActionResult {
    const t = thresholds ?? this.defaultThresholds;

    if (probability >= (t.approval ?? 0.9)) {
      return {
        action: "proceed",
        shouldAct: true,
        probability,
        confidence: this.getConfidence(probability, t.approval ?? 0.9),
        reason: "High confidence - auto-approved",
      };
    }

    if (probability >= (t.review ?? 0.5)) {
      return {
        action: "review",
        shouldAct: false,
        probability,
        confidence: this.getConfidence(probability, t.review ?? 0.5),
        reason: "Medium confidence - requires human review",
      };
    }

    return {
      action: "block",
      shouldAct: false,
      probability,
      confidence: this.getConfidence(probability, t.block ?? 0.2),
      reason: "Low confidence - blocked",
    };
  }

  /**
   * Decide with per-question thresholds
   */
  decideWithThresholds(
    probabilities: Record<string, number>,
    thresholds?: ThresholdConfig
  ): Record<string, ActionResult> {
    const results: Record<string, ActionResult> = {};

    for (const [questionId, probability] of Object.entries(probabilities)) {
      const questionThresholds = thresholds?.perQuestion?.[questionId] ?? thresholds;
      results[questionId] = this.decide(probability, questionThresholds);
    }

    return results;
  }

  /**
   * Route to appropriate handler based on decision
   */
  route<T>(
    decision: ActionResult,
    handlers: {
      onProceed?: () => T | Promise<T>;
      onReview?: () => T | Promise<T>;
      onBlock?: () => T | Promise<T>;
    }
  ): Promise<T> | T {
    switch (decision.action) {
      case "proceed":
        return handlers.onProceed?.() ?? ({} as T);
      case "review":
        return handlers.onReview?.() ?? ({} as T);
      case "block":
        return handlers.onBlock?.() ?? ({} as T);
    }
  }

  /**
   * Batch decision with voting
   */
  batchDecide(
    decisions: { id: string; probability: number }[],
    threshold = 0.5
  ): { passed: string[]; failed: string[]; threshold: number } {
    const passed: string[] = [];
    const failed: string[] = [];

    for (const decision of decisions) {
      if (decision.probability >= threshold) {
        passed.push(decision.id);
      } else {
        failed.push(decision.id);
      }
    }

    return { passed, failed, threshold };
  }

  /**
   * Weighted voting for multiple judges
   */
  weightedVote(
    votes: { weight: number; probability: number }[]
  ): { weightedAverage: number; decision: ActionResult } {
    const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
    const weightedAverage = votes.reduce(
      (sum, v) => sum + (v.probability * v.weight) / totalWeight,
      0
    );

    return {
      weightedAverage,
      decision: this.decide(weightedAverage),
    };
  }

  private getConfidence(
    probability: number,
    threshold: number
  ): "high" | "medium" | "low" {
    const distance = Math.abs(probability - threshold);
    if (distance > 0.3) return "high";
    if (distance > 0.15) return "medium";
    return "low";
  }
}

/**
 * Routing helpers for common use cases
 */
export class Router {
  /**
   * Route to todo or bd based on task description
   */
  static async routeTaskTracker(
    taskDescription: string,
    judge: JevJudge
  ): Promise<{ tracker: "todo" | "bd"; confidence: number }> {
    const result = await judge.evaluate(taskDescription, {
      useTodo: {
        type: "noul",
        instructions:
          "Is this a short-lived, session-specific task that doesn't need GitHub tracking?",
      },
    });

    const probability = (result.decisions.useTodo?.probability ?? 0.5);
    return {
      tracker: probability > 0.5 ? "todo" : "bd",
      confidence: Math.abs(probability - 0.5) * 2, // 0-1 scale
    };
  }

  /**
   * Route to appropriate severity level
   */
  static async routeSeverity(
    issue: string,
    judge: JevJudge
  ): Promise<{ severity: "critical" | "high" | "medium" | "low"; probability: number }> {
    const result = await judge.evaluate(issue, {
      severity: {
        type: "choice",
        instructions: "What is the severity level of this issue?",
        options: ["critical", "high", "medium", "low"],
      },
    });

    const severityDecision = result.decisions.severity as {
      response: { choice: string; confidence: number };
    };

    return {
      severity: (severityDecision?.response?.choice as "critical" | "high" | "medium" | "low") ?? "medium",
      probability: severityDecision?.response?.confidence ?? 0.5,
    };
  }
}
