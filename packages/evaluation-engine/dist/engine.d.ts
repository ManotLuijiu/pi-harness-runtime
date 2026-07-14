/**
 * Evaluation Engine (RFC-0057)
 *
 * Determines whether an agent-produced result is acceptable before advancing.
 */
import type { EvaluationRequest, EvaluationResult, EvaluationState, ScoringWeights } from "./types.js";
export declare class EvaluationEngine {
    private weights;
    private state;
    constructor(weights?: Partial<ScoringWeights>);
    /**
     * Evaluate a task against its acceptance criteria
     */
    evaluate(request: EvaluationRequest): EvaluationResult;
    /**
     * Get current evaluation state
     */
    getState(): EvaluationState;
    /**
     * Reset engine state
     */
    reset(): void;
}
export declare function createEvaluationEngine(weights?: Partial<ScoringWeights>): EvaluationEngine;
//# sourceMappingURL=engine.d.ts.map