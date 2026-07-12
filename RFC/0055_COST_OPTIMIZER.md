# RFC-0055 — Cost Optimizer

Status: Draft  
Target package: `packages/cost-optimizer`  
Depends on: RFC-0051 Capability Registry, RFC-0053 Model Registry, RFC-0054 Provider Router

## 1. Problem

The runtime needs intelligent cost management to minimize expenses while maintaining quality. Currently costs are not tracked or optimized. The Cost Optimizer provides budget tracking, cost forecasting, and model selection optimization.

## 2. Cost Tracking

```ts
export interface CostEntry {
  id: string;
  jobId: string;
  taskId?: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  currency: "USD" | "THB";
  timestamp: string;
}

export interface CostBudget {
  daily?: number;
  weekly?: number;
  monthly?: number;
  perJob?: number;
  perTask?: number;
}

export interface CostSummary {
  total: number;
  currency: "USD" | "THB";
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  byJob: Record<string, number>;
  period: CostPeriod;
}

export interface CostPeriod {
  start: string;
  end: string;
  type: "day" | "week" | "month" | "custom";
}
```

## 3. Optimizer Interface

```ts
export interface CostOptimizer {
  trackCost(entry: Omit<CostEntry, "id" | "timestamp">): CostEntry;
  getSummary(period: CostPeriod): CostSummary;
  getBudgetStatus(): BudgetStatus;
  canAfford(cost: number): boolean;
  shouldSwitchToCheaper(
    currentModel: ModelInfo,
    requiredCapabilities: Capability[],
    options?: SwitchOptions,
  ): ModelSwitchRecommendation | null;
  forecastCosts(jobRequirements: JobRequirements): CostForecast;
  optimizeModelSelection(
    task: RuntimeTask,
    requirements: TaskRequirements,
  ): OptimizedSelection[];
}

export interface BudgetStatus {
  daily: { used: number; budget: number; remaining: number };
  weekly: { used: number; budget: number; remaining: number };
  monthly: { used: number; budget: number; remaining: number };
  exhausted: boolean;
  nextReset?: string;
}

export interface SwitchOptions {
  maxQualityLoss?: number; // percentage
  maxLatencyIncrease?: "fast" | "medium" | "slow";
}

export interface ModelSwitchRecommendation {
  currentModel: ModelInfo;
  recommendedModel: ModelInfo;
  costSavings: number; // percentage
  qualityImpact: number; // percentage
  reason: string;
}

export interface CostForecast {
  estimatedTotal: number;
  byTaskType: Record<string, number>;
  confidence: number;
  assumptions: string[];
}

export interface TaskRequirements {
  requiredCapabilities: Capability[];
  minContextWindow: number;
  maxLatency?: "fast" | "medium" | "slow";
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface OptimizedSelection {
  model: ModelInfo;
  estimatedCost: number;
  qualityScore: number;
  reason: string;
  tradeoffs: string[];
}
```

## 4. Cost Tracking Algorithm

```ts
export function trackCost(
  optimizer: CostOptimizer,
  entry: Omit<CostEntry, "id" | "timestamp">,
): CostEntry {
  const costEntry: CostEntry = {
    ...entry,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };
  
  // Store in history
  optimizer.addToHistory(costEntry);
  
  // Check budget
  const status = optimizer.getBudgetStatus();
  if (status.exhausted) {
    optimizer.emit({
      type: "cost.budget_exhausted",
      status,
    });
  }
  
  return costEntry;
}

export function canAfford(
  optimizer: CostOptimizer,
  cost: number,
): boolean {
  const status = optimizer.getBudgetStatus();
  
  if (cost > status.daily.remaining && status.daily.budget) return false;
  if (cost > status.weekly.remaining && status.weekly.budget) return false;
  if (cost > status.monthly.remaining && status.monthly.budget) return false;
  
  return true;
}
```

## 5. Model Selection Optimization

```ts
export function shouldSwitchToCheaper(
  optimizer: CostOptimizer,
  currentModel: ModelInfo,
  requiredCapabilities: Capability[],
  options?: SwitchOptions,
): ModelSwitchRecommendation | null {
  const candidates = optimizer.findModels({
    capabilities: requiredCapabilities,
    status: "active",
  });
  
  // Filter by quality tolerance
  const maxQualityLoss = options?.maxQualityLoss ?? 20;
  
  const cheaperOptions = candidates
    .filter(m => {
      const currentCost = calculateModelCost(currentModel);
      const candidateCost = calculateModelCost(m);
      return candidateCost < currentCost;
    })
    .filter(m => {
      const qualityLoss = getQualityImpact(currentModel, m);
      return qualityLoss <= maxQualityLoss;
    })
    .map(m => ({
      model: m,
      costSavings: calculateSavings(currentModel, m),
      qualityImpact: getQualityImpact(currentModel, m),
    }))
    .sort((a, b) => b.costSavings - a.costSavings);
  
  if (cheaperOptions.length === 0) return null;
  
  const best = cheaperOptions[0];
  return {
    currentModel,
    recommendedModel: best.model,
    costSavings: best.costSavings,
    qualityImpact: best.qualityImpact,
    reason: `Switching from ${currentModel.id} to ${best.model.id} saves ${best.costSavings.toFixed(1)}% with ${best.qualityImpact.toFixed(1)}% quality impact`,
  };
}

export function optimizeModelSelection(
  optimizer: CostOptimizer,
  task: RuntimeTask,
  requirements: TaskRequirements,
): OptimizedSelection[] {
  const candidates = optimizer.findModels({
    capabilities: requirements.requiredCapabilities,
    status: "active",
  })
    .filter(m => m.contextWindow >= requirements.minContextWindow)
    .filter(m => !requirements.maxLatency || LATENCY_RANK[m.latency] <= LATENCY_RANK[requirements.maxLatency]);
  
  const baseTokens = requirements.estimatedInputTokens + requirements.estimatedOutputTokens;
  
  return candidates
    .map(m => {
      const estimatedCost = calculateCost(m, requirements.estimatedInputTokens, requirements.estimatedOutputTokens);
      const qualityScore = calculateQualityScore(m, requirements.requiredCapabilities);
      
      return {
        model: m,
        estimatedCost,
        qualityScore,
        reason: generateReason(m, estimatedCost, qualityScore),
        tradeoffs: generateTradeoffs(m, requirements),
      };
    })
    .sort((a, b) => {
      // Pareto-optimal: prefer lower cost at similar quality
      const qualityAdjusted = a.qualityScore * 0.6 - a.estimatedCost * 0.4;
      const qualityAdjustedB = b.qualityScore * 0.6 - b.estimatedCost * 0.4;
      return qualityAdjustedB - qualityAdjusted;
    });
}
```

## 6. Budget Configuration

```ts
export interface CostOptimizerConfig {
  defaultBudget: CostBudget;
  currency: "USD" | "THB";
  alertThreshold: number; // percentage of budget
  autoSwitchToCheaper: boolean;
  maxQualityLossPercent: number;
}

export const DEFAULT_CONFIG: CostOptimizerConfig = {
  defaultBudget: {
    daily: 10,
    weekly: 50,
    monthly: 200,
  },
  currency: "USD",
  alertThreshold: 0.8, // 80%
  autoSwitchToCheaper: false,
  maxQualityLossPercent: 15,
};
```

## 7. Events

```ts
type CostOptimizerEvent =
  | { type: "cost.tracked"; entryId: string; cost: number; total: number }
  | { type: "cost.budget_warning"; threshold: number; percentage: number }
  | { type: "cost.budget_exhausted"; period: string }
  | { type: "cost.switch_recommended"; from: string; to: string; savings: number }
  | { type: "cost.forecast"; estimated: number; confidence: number }
  | { type: "cost.optimization_applied"; model: string; savings: number };
```

## 8. Acceptance Criteria

- Cost entries are tracked with full metadata
- Budget status reflects current usage correctly
- Forecast provides reasonable estimates
- Model switch recommendations are sensible
- Optimized selections are Pareto-optimal
- Events are emitted for budget warnings and exhaustion
- Unit tests cover all scenarios
- Integration with Model Registry and Capability Registry works
