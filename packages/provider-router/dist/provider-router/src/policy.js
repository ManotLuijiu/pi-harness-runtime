/**
 * Default Routing Policy (RFC-0054)
 */
export const DEFAULT_ROUTING_POLICY = {
    defaultStrategy: "balanced",
    costWeight: 30,
    qualityWeight: 40,
    latencyWeight: 20,
    quotaWeight: 10,
    fallbackProviders: ["anthropic", "openai"],
    taskTypeOverrides: {
        planning: "best_quality",
        code_generation: "balanced",
        code_review: "best_quality",
        test_generation: "fastest",
        e2e_testing: "quota_aware",
        analysis: "best_quality",
        refactoring: "balanced",
        debugging: "fastest",
        documentation: "cheapest",
    },
    providerPreferences: {
        minimax: 20, // prefer cheaper options
        openai: 0,
        anthropic: 10,
    },
};
/**
 * Create a custom routing policy
 */
export function createRoutingPolicy(overrides) {
    return {
        ...DEFAULT_ROUTING_POLICY,
        ...overrides,
        taskTypeOverrides: {
            ...DEFAULT_ROUTING_POLICY.taskTypeOverrides,
            ...overrides.taskTypeOverrides,
        },
        providerPreferences: {
            ...DEFAULT_ROUTING_POLICY.providerPreferences,
            ...overrides.providerPreferences,
        },
    };
}
//# sourceMappingURL=policy.js.map