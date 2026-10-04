/**
 * Flaky Detector - Specialized module for detecting flaky tests
 *
 * Uses Jev to analyze test failures and determine if they're flaky.
 */
import type { JevJudgeConfig, E2ETestResult, E2EFlakyAnalysis } from "./types.js";
/**
 * Flaky Detector - Specialized for detecting flaky test failures
 */
export declare class FlakyDetector {
    private judge;
    private threshold;
    constructor(config: JevJudgeConfig, threshold?: number);
    /**
     * Quick pattern-based flaky detection (without Jev)
     * Used for fast, synchronous checks
     */
    detectPattern(errorMessage?: string): {
        isFlaky: boolean;
        pattern: string | null;
        confidence: "high" | "medium" | "low";
    };
    /**
     * AI-powered flaky detection with Jev
     */
    detect(testResult: E2ETestResult): Promise<E2EFlakyAnalysis>;
    /**
     * Batch detect flaky tests
     */
    batchDetect(testResults: E2ETestResult[]): Promise<Map<string, E2EFlakyAnalysis>>;
    private buildState;
    private getRecommendation;
}
//# sourceMappingURL=flaky-detector.d.ts.map