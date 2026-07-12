# RFC-0054 — Provider Router

Status: Draft  
Target package: `packages/provider-router`  
Depends on: RFC-0051 Capability Registry, RFC-0053 Model Registry

## 1. Problem

The SimpleProviderRouter exists but lacks:

- Capability-based filtering
- Cost-aware routing
- Quota-aware selection
- Multi-criteria optimization

The Enhanced Provider Router provides intelligent routing based on task requirements, model capabilities, cost constraints, and provider availability.

## 2. Router Interface

```ts
export interface ProviderRouter {
  selectProvider(
    task: RuntimeTask,
    context: RoutingContext,
    options?: RoutingOptions,
  ): Promise<RoutingDecision>;
  
  selectProviders(
    task: RuntimeTask,
    context: RoutingContext,
    count: number,
  ): Promise<RoutingDecision[]>;
  
  getRoutingPolicy(): RoutingPolicy;
  setRoutingPolicy(policy: RoutingPolicy): void;
}

export interface RoutingContext {
  task: RuntimeTask;
  requirement: CompiledRequirement;
  providerStates: Record<string, ProviderState>;
  quotaStates: Record<string, QuotaState>;
  costBudget?: CostBudget;
}

export interface RoutingOptions {
  preferCheapest?: boolean;
  preferFastest?: boolean;
  preferHighestQuality?: boolean;
  maxCostPerTask?: number;
  requiredCapabilities?: Capability[];
  preferProviders?: string[];
  avoidProviders?: string[];
}

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  reason: string;
  estimatedCost?: number;
  estimatedLatency?: "fast" | "medium" | "slow";
  confidence: number;
}
```

## 3. Routing Policy

```ts
export interface RoutingPolicy {
  defaultStrategy: RoutingStrategy;
  costWeight: number;      // 0-100
  qualityWeight: number;   // 0-100
  latencyWeight: number;   // 0-100
  quotaWeight: number;      // 0-100
  fallbackProviders: string[];
  taskTypeOverrides: Record<string, RoutingStrategy>;
  providerPreferences: Record<string, number>;
}

export type RoutingStrategy =
  | "cheapest"
  | "fastest"
  | "best_quality"
  | "balanced"
  | "quota_aware";
```

## 4. Selection Algorithm

```ts
export async function selectProvider(
  router: ProviderRouter,
  task: RuntimeTask,
  context: RoutingContext,
  options?: RoutingOptions,
): Promise<RoutingDecision> {
  const policy = router.getRoutingPolicy();
  const strategy = policy.taskTypeOverrides[task.type] ?? policy.defaultStrategy;
  
  // Get all candidates
  let candidates = await getEligibleCandidates(task, context, options);
  
  // Filter by capabilities
  if (options?.requiredCapabilities?.length) {
    candidates = candidates.filter(c => 
      options.requiredCapabilities!.every(cap => 
        c.capabilities.includes(cap)
      )
    );
  }
  
  // Filter by cost
  if (options?.maxCostPerTask) {
    candidates = candidates.filter(c => 
      (c.estimatedCost ?? Infinity) <= options.maxCostPerTask!
    );
  }
  
  // Filter by quota
  candidates = candidates.filter(c => {
    const quota = context.quotaStates[c.providerId];
    return !quota || !quota.exhausted;
  });
  
  if (candidates.length === 0) {
    throw new Error(`No eligible providers for task ${task.id}`);
  }
  
  // Apply strategy
  return applyStrategy(candidates, strategy, policy, options);
}

function applyStrategy(
  candidates: ProviderCandidate[],
  strategy: RoutingStrategy,
  policy: RoutingPolicy,
  options?: RoutingOptions,
): RoutingDecision {
  switch (strategy) {
    case "cheapest":
      return candidates
        .sort((a, b) => (a.estimatedCost ?? 0) - (b.estimatedCost ?? 0))[0];
    
    case "fastest":
      return candidates
        .sort((a, b) => LATENCY_RANK[a.estimatedLatency] - LATENCY_RANK[b.estimatedLatency])[0];
    
    case "best_quality":
      return candidates
        .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))[0];
    
    case "balanced":
      return candidates
        .sort((a, b) => {
          const scoreA = calculateWeightedScore(a, policy);
          const scoreB = calculateWeightedScore(b, policy);
          return scoreB - scoreA;
        })[0];
    
    case "quota_aware":
      return candidates
        .sort((a, b) => {
          const quotaA = a.remainingQuotaPct ?? 1;
          const quotaB = b.remainingQuotaPct ?? 1;
          const costA = a.estimatedCost ?? Infinity;
          const costB = b.estimatedCost ?? Infinity;
          return (quotaA / costA) - (quotaB / costB);
        })[0];
  }
}

function calculateWeightedScore(
  candidate: ProviderCandidate,
  policy: RoutingPolicy,
): number {
  const costScore = 100 - Math.min(candidate.estimatedCost ?? 0, 100);
  const qualityScore = candidate.qualityScore ?? 50;
  const latencyScore = 100 - (LATENCY_RANK[candidate.estimatedLatency] * 33);
  const quotaScore = (candidate.remainingQuotaPct ?? 1) * 100;
  
  return (
    (costScore * policy.costWeight +
      qualityScore * policy.qualityWeight +
      latencyScore * policy.latencyWeight +
      quotaScore * policy.quotaWeight) /
    (policy.costWeight + policy.qualityWeight + policy.latencyWeight + policy.quotaWeight)
  );
}
```

## 5. Default Policy

```ts
export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  defaultStrategy: "balanced",
  costWeight: 30,
  qualityWeight: 40,
  latencyWeight: 20,
  quotaWeight: 10,
  fallbackProviders: ["anthropic", "openai"],
  taskTypeOverrides: {
    "planning": "best_quality",
    "code_generation": "balanced",
    "code_review": "best_quality",
    "test_generation": "fastest",
    "e2e_testing": "quota_aware",
    "analysis": "best_quality",
    "refactoring": "balanced",
    "debugging": "fastest",
    "documentation": "cheapest",
  },
  providerPreferences: {
    "minimax": 20,   // prefer cheaper options
    "openai": 0,
    "anthropic": 10,
  },
};
```

## 6. Events

```ts
type ProviderRouterEvent =
  | { type: "router.provider_selected"; taskId: string; providerId: string; reason: string }
  | { type: "router.no_candidates"; taskId: string; reason: string }
  | { type: "router.policy_updated"; oldPolicy: RoutingPolicy; newPolicy: RoutingPolicy }
  | { type: "router.fallback_triggered"; taskId: string; originalProvider: string; fallbackProvider: string };
```

## 7. Acceptance Criteria

- Routing respects task type and capabilities
- Strategy selection works for all strategies
- Cost and quota filters are applied correctly
- Weighted scoring produces reasonable results
- Fallback providers are used when needed
- Events are emitted for all routing decisions
- Unit tests cover all strategies and scenarios
- Integration with Capability Registry and Model Registry works
