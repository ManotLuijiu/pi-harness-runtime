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
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    proceedThreshold: 0.7,
    cautionThreshold: 0.5,
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
                shouldProceed: {
                    type: "noul",
                    instructions: "The agent should continue with remaining tasks without waiting for user confirmation. Consider: task completion %, risk of wrong action, time sensitivity, user unavailability.",
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
                    instructions: "Would waiting for user confirmation significantly improve the outcome or prevent a serious mistake?",
                },
                taskComplexity: {
                    type: "score",
                    instructions: "How complex are the remaining tasks compared to completed ones?",
                    min: 1,
                    max: 5,
                },
            });
            return this.buildDecision(result, taskState);
        }
        catch (error) {
            console.error("[AutoContinueJudge] Jev call failed:", error);
            return this.fallbackDecision(taskState);
        }
    }
    /**
     * Quick decision - simple yes/no to proceed
     */
    async shouldContinue(taskState) {
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
    buildState(taskState) {
        const completionPercent = Math.round((taskState.completedTasks.length / taskState.totalTasks) * 100);
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
                session_duration_minutes: Math.round((Date.now() - taskState.sessionStartTime.getTime()) / 60000),
            },
        };
        return JSON.stringify(state, null, 2);
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
        // Calculate recommended wait time
        let waitRecommendation;
        if (action === "wait") {
            waitRecommendation = Math.min(this.config.maxWaitMinutes, Math.round(this.config.maxWaitMinutes * (1 - probability)));
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
export function createTaskState(completedTasks, remainingTasks, lastUserActivity, sessionStartTime) {
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
//# sourceMappingURL=auto-continue.js.map