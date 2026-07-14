/**
 * Performance Optimizer (RFC-0056)
 *
 * Analyzes runtime metrics and produces advisory optimization decisions.
 */
/**
 * Detect bottlenecks from metrics
 */
function detectBottlenecks(metrics) {
    const bottlenecks = [];
    const { currentContextTokens, contextWindow, retryCount, successCount, failureCount, } = metrics;
    // Context usage bottleneck
    const contextUsagePercent = (currentContextTokens / contextWindow) * 100;
    if (contextUsagePercent > 80) {
        bottlenecks.push("high_context_usage");
    }
    // Retry bottleneck
    const totalCalls = successCount + failureCount;
    if (totalCalls > 0 && retryCount / totalCalls > 0.3) {
        bottlenecks.push("high_retry_rate");
    }
    // Provider performance
    const avgLatency = metrics.avgLatencyMs;
    if (avgLatency > 30000) {
        bottlenecks.push("high_latency");
    }
    return bottlenecks;
}
/**
 * Normalize provider metrics
 */
function normalizeProviderStats(providerMetrics) {
    const normalized = {};
    for (const [providerId, stats] of Object.entries(providerMetrics)) {
        const total = stats.callCount;
        if (total > 0) {
            normalized[providerId] = {
                successRate: stats.successCount / total,
                failureRate: stats.failureCount / total,
            };
        }
    }
    return normalized;
}
/**
 * Generate context reduction recommendation
 */
function suggestContextReduction(metrics, policy) {
    const { currentContextTokens, contextWindow } = metrics;
    const usagePercent = (currentContextTokens / contextWindow) * 100;
    if (usagePercent < 50) {
        return null; // No reduction needed
    }
    // Calculate target (reduce to 60% of current)
    const targetTokens = Math.floor(currentContextTokens * 0.6);
    const reductionPercent = ((currentContextTokens - targetTokens) / currentContextTokens) * 100;
    if (reductionPercent < policy.minContextReductionPercent) {
        return null;
    }
    return {
        type: "reduce_context",
        targetTokens,
        reason: `Context usage at ${usagePercent.toFixed(1)}% (${currentContextTokens}/${contextWindow} tokens). Reduce to ~60% to improve performance.`,
    };
}
/**
 * Generate provider change recommendation
 */
function suggestProviderChange(metrics, providerStates, policy) {
    if (!policy.allowProviderSwitch) {
        return null;
    }
    const providerStats = normalizeProviderStats(metrics.providerMetrics);
    // Find worst performing provider
    let worstProvider = null;
    let worstFailureRate = 0;
    for (const [providerId, stats] of Object.entries(providerStats)) {
        if (stats.failureRate > worstFailureRate && stats.failureRate > 0.1) {
            worstProvider = providerId;
            worstFailureRate = stats.failureRate;
        }
    }
    if (!worstProvider) {
        return null;
    }
    // Check if there's a better available provider
    const availableProviders = providerStates.filter((p) => p.state === "available" && p.providerId !== worstProvider);
    if (availableProviders.length === 0) {
        return null; // No alternative available
    }
    return {
        type: "change_provider",
        provider: availableProviders[0].providerId,
        reason: `Provider '${worstProvider}' has ${(worstFailureRate * 100).toFixed(1)}% failure rate. Switch to '${availableProviders[0].providerId}' for better reliability.`,
    };
}
/**
 * Generate parallelism recommendations
 */
function suggestParallelismChanges(metrics, providerStates, policy, taskGraph) {
    const recommendations = [];
    // Check for blocked tasks that could be parallel
    if (taskGraph) {
        const runningTasks = taskGraph.nodes.filter((n) => n.status === "running");
        const readyTasks = taskGraph.nodes.filter((n) => n.status === "ready");
        // If we have many ready tasks and few running, suggest increasing parallelism
        if (readyTasks.length > 5 && runningTasks.length < 3) {
            const suggestedLimit = Math.min(runningTasks.length + 2, policy.maxParallelism);
            if (suggestedLimit > runningTasks.length) {
                recommendations.push({
                    type: "increase_parallelism",
                    limit: suggestedLimit,
                    reason: `${readyTasks.length} tasks waiting. Increase parallelism to ${suggestedLimit} for faster completion.`,
                });
            }
        }
        // If too many tasks are hitting resource limits, suggest decreasing
        const limitedProviders = providerStates.filter((p) => p.state === "limited");
        if (limitedProviders.length > 0 && runningTasks.length > 5) {
            recommendations.push({
                type: "decrease_parallelism",
                limit: Math.max(2, runningTasks.length - 2),
                reason: `Provider quota limited. Reduce parallelism to ${Math.max(2, runningTasks.length - 2)} to avoid quota exhaustion.`,
            });
        }
    }
    return recommendations;
}
/**
 * Resolve conflicting recommendations
 */
function resolveConflicts(recommendations, policy) {
    // Sort by type priority (reductions first, then parallelism, then provider)
    const priority = {
        reduce_context: 1,
        decrease_parallelism: 2,
        increase_parallelism: 3,
        change_provider: 4,
        reuse_checkpoint: 5,
        skip_redundant_step: 6,
    };
    // Remove duplicates and conflicting recommendations
    const seen = new Set();
    const resolved = [];
    for (const rec of recommendations.sort((a, b) => priority[a.type] - priority[b.type])) {
        const key = rec.type;
        // Check for conflicts
        if (key === "increase_parallelism" &&
            resolved.some((r) => r.type === "decrease_parallelism")) {
            continue; // Skip increase if decrease already added
        }
        if (key === "decrease_parallelism" &&
            resolved.some((r) => r.type === "increase_parallelism")) {
            // Remove increase and add decrease
            const idx = resolved.findIndex((r) => r.type === "increase_parallelism");
            if (idx !== -1)
                resolved.splice(idx, 1);
        }
        if (!seen.has(key)) {
            seen.add(key);
            resolved.push(rec);
        }
    }
    return resolved;
}
/**
 * Calculate expected impact
 */
function calculateImpact(metrics, recommendations) {
    let tokenReduction = 0;
    let latencyReduction = 0;
    let retryReduction = 0;
    for (const rec of recommendations) {
        switch (rec.type) {
            case "reduce_context":
                // Estimate 15-30% latency improvement from context reduction
                latencyReduction += 20;
                break;
            case "change_provider":
                // Estimate 10-25% latency improvement from better provider
                latencyReduction += 15;
                break;
            case "decrease_parallelism":
                // Reduce contention
                latencyReduction += 10;
                retryReduction += 15;
                break;
            case "skip_redundant_step":
                tokenReduction += 10;
                break;
        }
    }
    return {
        tokenReductionPercent: tokenReduction > 0 ? Math.min(tokenReduction, 50) : undefined,
        latencyReductionPercent: latencyReduction > 0 ? Math.min(latencyReduction, 40) : undefined,
        retryReductionPercent: retryReduction > 0 ? Math.min(retryReduction, 30) : undefined,
    };
}
export class PerformanceOptimizer {
    policy;
    constructor(policy = {}) {
        this.policy = {
            minContextReductionPercent: 10,
            maxParallelism: 10,
            minImprovementPercent: 5,
            allowProviderSwitch: true,
            mandatoryStages: [],
            ...policy,
        };
    }
    /**
     * Analyze metrics and produce optimization recommendations
     */
    analyze(request) {
        const { jobId, metrics, providerStates } = request;
        // Emit start event
        this.emit({ type: "performance.analysis.started", jobId });
        try {
            // 1. Detect bottlenecks
            const bottlenecks = detectBottlenecks(metrics);
            // 2. Generate recommendations
            const recommendations = [];
            // Context reduction
            const contextRec = suggestContextReduction(metrics, this.policy);
            if (contextRec) {
                recommendations.push(contextRec);
                this.emit({
                    type: "performance.recommendation.created",
                    jobId,
                    recommendation: contextRec,
                });
            }
            // Provider change
            const providerRec = suggestProviderChange(metrics, providerStates, this.policy);
            if (providerRec) {
                recommendations.push(providerRec);
                this.emit({
                    type: "performance.recommendation.created",
                    jobId,
                    recommendation: providerRec,
                });
            }
            // Parallelism changes
            const parallelismRecs = suggestParallelismChanges(metrics, providerStates, this.policy, request.taskGraph);
            for (const rec of parallelismRecs) {
                recommendations.push(rec);
                this.emit({
                    type: "performance.recommendation.created",
                    jobId,
                    recommendation: rec,
                });
            }
            // 3. Resolve conflicts
            const resolved = resolveConflicts(recommendations, this.policy);
            // 4. Calculate impact
            const expectedImpact = calculateImpact(metrics, resolved);
            this.emit({ type: "performance.analysis.completed", jobId });
            return {
                jobId,
                recommendations: resolved,
                expectedImpact,
                generatedAt: new Date().toISOString(),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.emit({
                type: "performance.analysis.failed",
                jobId,
                error: errorMessage,
            });
            return {
                jobId,
                recommendations: [],
                expectedImpact: {},
                generatedAt: new Date().toISOString(),
            };
        }
    }
    eventListeners = [];
    /**
     * Subscribe to optimizer events
     */
    onEvent(listener) {
        this.eventListeners.push(listener);
        return () => {
            this.eventListeners = this.eventListeners.filter((l) => l !== listener);
        };
    }
    emit(event) {
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            }
            catch {
                // Best effort
            }
        }
    }
}
// ─── Factory ───────────────────────────────────────────────────────────────
export function createPerformanceOptimizer(policy) {
    return new PerformanceOptimizer(policy);
}
//# sourceMappingURL=optimizer.js.map