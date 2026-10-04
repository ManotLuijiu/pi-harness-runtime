/**
 * E2E Judge - Automated decision making for E2E testing
 *
 * Uses Jev to make fast, calibrated decisions about:
 * - Test flakiness detection
 * - Build blocking decisions
 * - Retry recommendations
 * - Error classification
 */
import { type JevJudgeConfig } from "./index.js";
import type { E2ETestResult, E2EFlakyAnalysis, E2EBuildDecision, E2ERetryDecision } from "./types.js";
/**
 * E2E Judge - Specialized judge for E2E testing decisions
 */
export declare class E2EJudge {
    private judge;
    private config;
    constructor(config: JevJudgeConfig, options?: {
        flakyThreshold?: number;
        blockThreshold?: number;
        retryThreshold?: number;
    });
    /**
     * Analyze if a test failure is likely a flaky test
     */
    analyzeFlakiness(testResult: E2ETestResult): Promise<E2EFlakyAnalysis>;
    /**
     * Decide if a test failure should block the build
     */
    shouldBlockBuild(testResult: E2ETestResult): Promise<E2EBuildDecision>;
    /**
     * Decide if a failed test should be retried
     */
    shouldRetry(testResult: E2ETestResult): Promise<E2ERetryDecision>;
    /**
     * Classify a test error into categories
     */
    classifyError(errorMessage: string, testName?: string): Promise<{
        category: string;
        subcategory?: string;
        isKnown: boolean;
        probability: number;
    }>;
    /**
     * Batch analyze multiple test results
     */
    batchAnalyze(testResults: E2ETestResult[]): Promise<{
        flaky: E2ETestResult[];
        shouldBlock: E2ETestResult[];
        toRetry: {
            test: E2ETestResult;
            decision: E2ERetryDecision;
        }[];
        passed: E2ETestResult[];
    }>;
    private buildFlakyState;
    private buildBuildBlockState;
    private buildRetryState;
    private getFlakyRecommendation;
}
//# sourceMappingURL=e2e-judge.d.ts.map