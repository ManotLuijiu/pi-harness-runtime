/**
 * Decision Engine - Threshold-based routing and action decisions
 *
 * Wraps Jev decisions with configurable thresholds for automated actions.
 */
import { JevJudge } from "./index.js";
/**
 * Decision Engine - Makes automated decisions based on Jev probabilities
 */
export class DecisionEngine {
    judge;
    defaultThresholds;
    constructor(config, thresholds) {
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
    decide(probability, thresholds) {
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
    decideWithThresholds(probabilities, thresholds) {
        const results = {};
        for (const [questionId, probability] of Object.entries(probabilities)) {
            const questionThresholds = thresholds?.perQuestion?.[questionId] ?? thresholds;
            results[questionId] = this.decide(probability, questionThresholds);
        }
        return results;
    }
    /**
     * Route to appropriate handler based on decision
     */
    route(decision, handlers) {
        switch (decision.action) {
            case "proceed":
                return handlers.onProceed?.() ?? {};
            case "review":
                return handlers.onReview?.() ?? {};
            case "block":
                return handlers.onBlock?.() ?? {};
        }
    }
    /**
     * Batch decision with voting
     */
    batchDecide(decisions, threshold = 0.5) {
        const passed = [];
        const failed = [];
        for (const decision of decisions) {
            if (decision.probability >= threshold) {
                passed.push(decision.id);
            }
            else {
                failed.push(decision.id);
            }
        }
        return { passed, failed, threshold };
    }
    /**
     * Weighted voting for multiple judges
     */
    weightedVote(votes) {
        const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
        const weightedAverage = votes.reduce((sum, v) => sum + (v.probability * v.weight) / totalWeight, 0);
        return {
            weightedAverage,
            decision: this.decide(weightedAverage),
        };
    }
    getConfidence(probability, threshold) {
        const distance = Math.abs(probability - threshold);
        if (distance > 0.3)
            return "high";
        if (distance > 0.15)
            return "medium";
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
    static async routeTaskTracker(taskDescription, judge) {
        const result = await judge.evaluate(taskDescription, {
            useTodo: {
                type: "noul",
                instructions: "Is this a short-lived, session-specific task that doesn't need GitHub tracking?",
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
    static async routeSeverity(issue, judge) {
        const result = await judge.evaluate(issue, {
            severity: {
                type: "choice",
                instructions: "What is the severity level of this issue?",
                options: ["critical", "high", "medium", "low"],
            },
        });
        const severityDecision = result.decisions.severity;
        return {
            severity: severityDecision?.response?.choice ?? "medium",
            probability: severityDecision?.response?.confidence ?? 0.5,
        };
    }
}
//# sourceMappingURL=decision-engine.js.map