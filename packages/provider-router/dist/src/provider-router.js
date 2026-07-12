/**
 * Enhanced Provider Router (RFC-0054)
 */
import { DEFAULT_ROUTING_POLICY } from "./policy.js";
import { applyStrategy, createDecision, calculateWeightedScore, } from "./strategies.js";
/**
 * Enhanced Provider Router with capability and cost awareness
 */
export class EnhancedProviderRouter {
    policy;
    eventHandlers = new Set();
    // Default providers for fallback
    defaultCandidates = [
        {
            providerId: "anthropic",
            modelId: "claude-sonnet-4",
            estimatedCost: 0.003, // $3/1M tokens average
            estimatedLatency: "fast",
            qualityScore: 90,
        },
        {
            providerId: "openai",
            modelId: "gpt-4o-mini",
            estimatedCost: 0.0006,
            estimatedLatency: "fast",
            qualityScore: 82,
        },
        {
            providerId: "minimax",
            modelId: "MiniMax-Text-01",
            estimatedCost: 0.0001,
            estimatedLatency: "fast",
            qualityScore: 75,
        },
        {
            providerId: "google",
            modelId: "gemini-1.5-flash",
            estimatedCost: 0.00007,
            estimatedLatency: "fast",
            qualityScore: 78,
        },
    ];
    constructor(policy) {
        this.policy = policy ?? DEFAULT_ROUTING_POLICY;
    }
    /**
     * Select the best provider for a task
     */
    async selectProvider(task, context, options) {
        const candidates = this.buildCandidates(context, options);
        // Filter candidates
        const filtered = this.filterCandidates(candidates, context, options);
        if (filtered.length === 0) {
            this.emit({
                type: "router.no_candidates",
                taskId: task.id,
                reason: "All candidates filtered out",
            });
            // Fallback to default
            const fallback = this.policy.fallbackProviders[0];
            const defaultCandidate = this.defaultCandidates.find((c) => c.providerId === fallback) ??
                this.defaultCandidates[0];
            return createDecision({
                providerId: defaultCandidate.providerId,
                modelId: defaultCandidate.modelId,
                capabilities: [],
                estimatedCost: defaultCandidate.estimatedCost,
                estimatedLatency: defaultCandidate.estimatedLatency ?? "medium",
                qualityScore: defaultCandidate.qualityScore,
                remainingQuotaPct: context.quotaStates[defaultCandidate.providerId]?.remainingPct ?? 1,
            }, `Fallback to ${defaultCandidate.providerId}`);
        }
        // Determine strategy
        const strategy = this.determineStrategy(task, options);
        // Apply strategy
        const selected = applyStrategy(filtered, strategy, this.policy, options);
        const decision = createDecision(selected, `Selected via ${strategy} strategy`);
        this.emit({
            type: "router.provider_selected",
            taskId: task.id,
            providerId: decision.providerId,
            reason: decision.reason,
        });
        return decision;
    }
    /**
     * Select multiple providers
     */
    async selectProviders(task, context, count) {
        const candidates = this.buildCandidates(context);
        const sorted = candidates.sort((a, b) => {
            return (calculateWeightedScore(b, this.policy) -
                calculateWeightedScore(a, this.policy));
        });
        const selected = sorted.slice(0, count);
        return selected.map((c, i) => createDecision(c, `Ranked #${i + 1} for ${task.id}`));
    }
    /**
     * Get current routing policy
     */
    getRoutingPolicy() {
        return { ...this.policy };
    }
    /**
     * Update routing policy
     */
    setRoutingPolicy(policy) {
        const oldPolicy = this.policy;
        this.policy = policy;
        this.emit({
            type: "router.policy_updated",
            oldPolicy,
            newPolicy: policy,
        });
    }
    /**
     * Subscribe to events
     */
    onEvent(handler) {
        this.eventHandlers.add(handler);
        return () => this.eventHandlers.delete(handler);
    }
    /**
     * Build candidate list from context
     */
    buildCandidates(context, options) {
        const candidates = [];
        // Add default candidates
        for (const candidate of this.defaultCandidates) {
            const providerState = context.providerStates[candidate.providerId] ?? "unknown";
            const quotaState = context.quotaStates[candidate.providerId];
            // Skip disabled providers
            if (providerState === "disabled")
                continue;
            candidates.push({
                providerId: candidate.providerId,
                modelId: candidate.modelId,
                capabilities: [], // Would be populated from capability registry
                estimatedCost: candidate.estimatedCost,
                estimatedLatency: candidate.estimatedLatency ?? "medium",
                qualityScore: candidate.qualityScore,
                remainingQuotaPct: quotaState?.remainingPct ?? 1,
            });
        }
        return candidates;
    }
    /**
     * Filter candidates based on options and context
     */
    filterCandidates(candidates, context, options) {
        let filtered = [...candidates];
        // Filter by cost
        if (options?.maxCostPerTask) {
            filtered = filtered.filter((c) => (c.estimatedCost ?? Infinity) <= options.maxCostPerTask);
        }
        // Filter by quota
        filtered = filtered.filter((c) => {
            const quota = context.quotaStates[c.providerId];
            return !quota || !quota.exhausted;
        });
        // Filter by provider state
        filtered = filtered.filter((c) => {
            const state = context.providerStates[c.providerId] ?? "unknown";
            return state !== "disabled" && state !== "exhausted";
        });
        // Prefer providers
        if (options?.preferProviders?.length) {
            filtered.sort((a, b) => {
                const aPreferred = options.preferProviders.includes(a.providerId)
                    ? 1
                    : 0;
                const bPreferred = options.preferProviders.includes(b.providerId)
                    ? 1
                    : 0;
                return bPreferred - aPreferred;
            });
        }
        // Avoid providers
        if (options?.avoidProviders?.length) {
            filtered = filtered.filter((c) => !options.avoidProviders.includes(c.providerId));
        }
        return filtered;
    }
    /**
     * Determine routing strategy for a task
     */
    determineStrategy(task, options) {
        // Check for explicit preferences
        if (options?.preferCheapest)
            return "cheapest";
        if (options?.preferFastest)
            return "fastest";
        if (options?.preferHighestQuality)
            return "best_quality";
        // Check task type override
        if (this.policy.taskTypeOverrides[task.type]) {
            return this.policy.taskTypeOverrides[task.type];
        }
        // Fall back to default
        return this.policy.defaultStrategy;
    }
    /**
     * Emit an event
     */
    emit(event) {
        for (const handler of this.eventHandlers) {
            try {
                handler(event);
            }
            catch {
                // Ignore handler errors
            }
        }
    }
}
/**
 * Create a new provider router
 */
export function createProviderRouter(policy) {
    return new EnhancedProviderRouter(policy);
}
//# sourceMappingURL=provider-router.js.map