/**
 * Learning Engine (RFC-0058)
 *
 * Extracts reusable lessons from completed and failed jobs.
 */
import type { LearningRequest, LearningResult, LearnedExperience } from "./types.js";
export declare class LearningEngine {
    private framework?;
    private repository?;
    constructor(options?: {
        framework?: string;
        repository?: string;
    });
    /**
     * Extract learned experiences from completed job
     */
    learn(request: LearningRequest): LearningResult;
    /**
     * Approve a learned experience
     */
    approve(experience: LearnedExperience): LearnedExperience;
    /**
     * Reject a learned experience
     */
    reject(experience: LearnedExperience): LearnedExperience;
    /**
     * Export experience to OKF format
     */
    toOkfFormat(experience: LearnedExperience): string;
}
export declare function createLearningEngine(options?: {
    framework?: string;
    repository?: string;
}): LearningEngine;
//# sourceMappingURL=engine.d.ts.map