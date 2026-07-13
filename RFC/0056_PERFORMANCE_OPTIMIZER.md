# RFC-0056 — Performance Optimizer

## 1. Purpose

The Performance Optimizer improves runtime throughput and reduces waste without changing task semantics. It analyzes execution metrics and produces advisory optimization decisions for scheduling, provider selection, context size, retry policy, and concurrency.

It does not directly execute tasks, modify source code, or override mandatory project policy.

## 2. Inputs

```ts
export interface PerformanceOptimizationRequest {
  jobId: string;
  taskId?: string;
  metrics: RuntimeMetricSnapshot;
  providerStates: ProviderRuntimeState[];
  taskGraph: TaskGraphSnapshot;
  policy: PerformancePolicy;
}
```

## 3. Outputs

```ts
export interface PerformanceOptimizationPlan {
  jobId: string;
  recommendations: PerformanceRecommendation[];
  expectedImpact: {
    tokenReductionPercent?: number;
    latencyReductionPercent?: number;
    retryReductionPercent?: number;
  };
  generatedAt: string;
}
```

## 4. Recommendation Types

```ts
export type PerformanceRecommendation =
  | { type: "reduce_context"; targetTokens: number; reason: string }
  | { type: "change_provider"; provider: string; reason: string }
  | { type: "increase_parallelism"; limit: number; reason: string }
  | { type: "decrease_parallelism"; limit: number; reason: string }
  | { type: "reuse_checkpoint"; checkpointId: string; reason: string }
  | { type: "skip_redundant_step"; taskId: string; reason: string };
```

## 5. Optimization Rules

The optimizer may recommend:

- Reusing unchanged compiled context.
- Reusing successful checkpoints.
- Avoiding repeated repository scans.
- Reducing unnecessary provider switching.
- Limiting parallel tasks that touch overlapping files.
- Increasing parallelism for independent read-only tasks.
- Routing short deterministic work to lower-cost providers.
- Escalating complex review tasks to stronger models.

## 6. Safety Boundaries

The optimizer must never:

- Skip mandatory review or E2E stages.
- Remove project rules.
- Override security policy.
- Execute `build`, `migrate`, or `commit` without approval.
- Modify acceptance criteria.
- Hide failed tests.

## 7. Algorithm

```text
collect metrics
 -> normalize provider/task statistics
 -> detect bottlenecks
 -> evaluate safe optimizations
 -> rank recommendations
 -> remove conflicting recommendations
 -> emit advisory plan
```

## 8. Runtime Events

```ts
type PerformanceOptimizerEvent =
  | { type: "performance.analysis.started"; jobId: string }
  | { type: "performance.recommendation.created"; jobId: string; recommendation: PerformanceRecommendation }
  | { type: "performance.analysis.completed"; jobId: string }
  | { type: "performance.analysis.failed"; jobId: string; error: string };
```

## 9. Failure Handling

- Missing metrics: return no-op recommendation set.
- Conflicting recommendations: keep the safer option.
- Unknown provider capability: do not route to that provider.
- Incomplete task graph: disable concurrency recommendations.
- Invalid policy: fail with typed configuration error.

## 10. Tests

- Recommends context reuse when hashes match.
- Does not skip required E2E stage.
- Reduces concurrency when file overlap exists.
- Does not choose unavailable provider.
- Produces deterministic recommendation ranking.
- Emits no-op plan when metrics are insufficient.

## 11. Acceptance Criteria

- Output is advisory and typed.
- Recommendations are deterministic for identical inputs.
- No mandatory stage is removed.
- Every recommendation contains a reason.
- Policy conflicts are rejected.
