/**
 * E2E Judge - Automated decision making for E2E testing
 *
 * Uses Jev to make fast, calibrated decisions about:
 * - Test flakiness detection
 * - Build blocking decisions
 * - Retry recommendations
 * - Error classification
 */
import { JevJudge } from "./index.js";
/**
 * E2E Judge - Specialized judge for E2E testing decisions
 */
export class E2EJudge {
    judge;
    config;
    constructor(config, options) {
        this.judge = new JevJudge(config);
        this.config = {
            flakyThreshold: options?.flakyThreshold ?? 0.7,
            blockThreshold: options?.blockThreshold ?? 0.8,
            retryThreshold: options?.retryThreshold ?? 0.6,
        };
    }
    /**
     * Analyze if a test failure is likely a flaky test
     */
    async analyzeFlakiness(testResult) {
        const state = this.buildFlakyState(testResult);
        const result = await this.judge.evaluate(state, {
            isFlaky: {
                type: "noul",
                instructions: "Does this failure match a known flaky test pattern? Consider: timeout, race condition, network issue, or intermittent UI state.",
            },
            pattern: {
                type: "choice",
                instructions: "What is the most likely cause of this failure?",
                options: [
                    "timeout",
                    "race_condition",
                    "network_issue",
                    "ui_state",
                    "data_issue",
                    "real_bug",
                    "unknown",
                ],
            },
            confidence: {
                type: "noul",
                instructions: "Is this a confident assessment based on clear evidence in the error message?",
            },
        });
        const isFlakyDecision = result.decisions.isFlaky;
        const patternDecision = result.decisions.pattern;
        const probability = isFlakyDecision.probability ?? 0;
        const isFlaky = probability >= (this.config.flakyThreshold ?? 0.7);
        return {
            isFlaky,
            confidence: isFlakyDecision.confidence,
            probability,
            pattern: patternDecision?.response?.choice,
            recommendation: this.getFlakyRecommendation(isFlaky, probability),
        };
    }
    /**
     * Decide if a test failure should block the build
     */
    async shouldBlockBuild(testResult) {
        const state = this.buildBuildBlockState(testResult);
        const result = await this.judge.evaluate(state, {
            blocksBuild: {
                type: "noul",
                instructions: "Would this failure indicate a real regression that should block the build? Consider: is this a core functionality, critical path, or user-facing feature?",
            },
            severity: {
                type: "choice",
                instructions: "What is the impact level of this failure?",
                options: ["critical", "high", "medium", "low"],
            },
            reason: {
                type: "choice",
                instructions: "What is the primary reason this would block the build?",
                options: [
                    "core_functionality",
                    "critical_path",
                    "user_facing",
                    "performance",
                    "cosmetic",
                    "flaky",
                    "known_issue",
                ],
            },
        });
        const blockDecision = result.decisions.blocksBuild;
        const probability = blockDecision.probability ?? 0;
        const shouldBlock = probability >= (this.config.blockThreshold ?? 0.8);
        const reasonDecision = result.decisions.reason;
        return {
            shouldBlock,
            probability,
            confidence: blockDecision.confidence,
            reason: reasonDecision?.response?.choice ?? "unknown",
            affectedTests: [testResult.name],
        };
    }
    /**
     * Decide if a failed test should be retried
     */
    async shouldRetry(testResult) {
        const state = this.buildRetryState(testResult);
        const result = await this.judge.evaluate(state, {
            shouldRetry: {
                type: "noul",
                instructions: "Is this failure likely transient and worth retrying? Consider: timeout, network error, resource contention, or race conditions.",
            },
            attempts: {
                type: "choice",
                instructions: "How many retry attempts are recommended?",
                options: ["1", "2", "3", "5", "dont_retry"],
            },
            delay: {
                type: "score",
                instructions: "How long should we wait before retrying (in seconds)?",
                min: 0,
                max: 30,
            },
        });
        const retryDecision = result.decisions.shouldRetry;
        const attemptsDecision = result.decisions.attempts;
        const delayDecision = result.decisions.delay;
        const probability = retryDecision.probability ?? 0;
        const shouldRetry = probability >= (this.config.retryThreshold ?? 0.6);
        const attemptsStr = attemptsDecision?.response?.choice ?? "1";
        const maxAttempts = attemptsStr === "dont_retry" ? 0 : parseInt(attemptsStr, 10);
        return {
            shouldRetry: shouldRetry && maxAttempts > 0,
            maxAttempts,
            probability,
            delayMs: delayDecision?.response?.score
                ? delayDecision.response.score * 1000
                : undefined,
        };
    }
    /**
     * Classify a test error into categories
     */
    async classifyError(errorMessage, testName) {
        const state = testName
            ? `Test: ${testName}\nError: ${errorMessage}`
            : errorMessage;
        const result = await this.judge.evaluate(state, {
            category: {
                type: "choice",
                instructions: "What is the primary category of this error?",
                options: [
                    "assertion",
                    "timeout",
                    "network",
                    "permission",
                    "data",
                    "ui",
                    "api",
                    "auth",
                    "config",
                    "unknown",
                ],
            },
            isKnown: {
                type: "noul",
                instructions: "Is this a known, expected error pattern (e.g., known bug, expected failure)?",
            },
        });
        const categoryDecision = result.decisions.category;
        const isKnownDecision = result.decisions.isKnown;
        return {
            category: categoryDecision?.response?.choice ?? "unknown",
            isKnown: isKnownDecision?.response?.noul
                ? isKnownDecision.response.noul > 0.5
                : false,
            probability: isKnownDecision.probability ?? 0.5,
        };
    }
    /**
     * Batch analyze multiple test results
     */
    async batchAnalyze(testResults) {
        const flaky = [];
        const shouldBlock = [];
        const toRetry = [];
        const passed = [];
        // Process in batches to avoid rate limiting
        const BATCH_SIZE = 5;
        for (let i = 0; i < testResults.length; i += BATCH_SIZE) {
            const batch = testResults.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(async (test) => {
                if (test.status === "passed") {
                    return { test, type: "passed" };
                }
                const [flakyResult, retryDecision] = await Promise.all([
                    this.analyzeFlakiness(test),
                    this.shouldRetry(test),
                ]);
                return { test, flakyResult, retryDecision, type: "failed" };
            }));
            for (const result of results) {
                if (result.type === "passed") {
                    passed.push(result.test);
                }
                else {
                    if (result.flakyResult?.isFlaky) {
                        flaky.push(result.test);
                    }
                    if (result.retryDecision?.shouldRetry) {
                        toRetry.push({ test: result.test, decision: result.retryDecision });
                    }
                    const blockDecision = await this.shouldBlockBuild(result.test);
                    if (blockDecision.shouldBlock) {
                        shouldBlock.push(result.test);
                    }
                }
            }
        }
        return { flaky, shouldBlock, toRetry, passed };
    }
    // Private helpers
    buildFlakyState(test) {
        const parts = [`Test: ${test.name}`, `Status: ${test.status}`];
        if (test.error) {
            parts.push(`Error: ${test.error}`);
        }
        if (test.retries !== undefined) {
            parts.push(`Previous retries: ${test.retries}`);
        }
        if (test.duration !== undefined) {
            parts.push(`Duration: ${test.duration}ms`);
        }
        return parts.join("\n");
    }
    buildBuildBlockState(test) {
        const parts = [
            `Test: ${test.name}`,
            `Status: ${test.status}`,
            `Test duration: ${test.duration ?? "unknown"}ms`,
        ];
        if (test.error) {
            parts.push(`Error: ${test.error}`);
        }
        return parts.join("\n");
    }
    buildRetryState(test) {
        const parts = [
            `Test: ${test.name}`,
            `Error: ${test.error ?? "No error message"}`,
            `Retries so far: ${test.retries ?? 0}`,
        ];
        return parts.join("\n");
    }
    getFlakyRecommendation(isFlaky, probability) {
        if (!isFlaky) {
            return probability > 0.5 ? "investigate" : "block";
        }
        if (probability > 0.9) {
            return "skip";
        }
        return "retry";
    }
}
//# sourceMappingURL=e2e-judge.js.map