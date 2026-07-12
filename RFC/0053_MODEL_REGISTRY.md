# RFC-0053 — Model Registry

Status: Draft  
Target package: `packages/model-registry`  
Depends on: RFC-0051 Capability Registry

## 1. Problem

The runtime needs a centralized registry of available AI models with their properties (pricing, limits, capabilities). Currently model info is scattered. The Model Registry provides a single source of truth for model metadata.

## 2. Model Definition

```ts
export interface ModelInfo {
  id: string;
  providerId: string;
  name: string;
  version?: string;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: Pricing;
  capabilities: string[]; // references to Capability IDs
  aliases: string[];
  status: "active" | "deprecated" | "disabled";
  releasedAt?: string;
  deprecatedAt?: string;
}

export interface Pricing {
  currency: "USD" | "THB";
  inputPer1M: number;  // cost per 1M input tokens
  outputPer1M: number; // cost per 1M output tokens
  batchInputPer1M?: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
}
```

## 3. Registry Interface

```ts
export interface ModelRegistry {
  register(model: ModelInfo): void;
  unregister(providerId: string, modelId: string): void;
  get(providerId: string, modelId: string): ModelInfo | undefined;
  getByAlias(alias: string): ModelInfo | undefined;
  list(providerId?: string): ModelInfo[];
  listActive(): ModelInfo[];
  find(filters: ModelFilters): ModelInfo[];
  updateStatus(providerId: string, modelId: string, status: ModelInfo["status"]): void;
}

export interface ModelFilters {
  providerId?: string;
  minContextWindow?: number;
  maxCostPer1M?: number;
  capabilities?: string[];
  status?: ModelInfo["status"];
}
```

## 4. Default Models

```ts
export const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    providerId: "openai",
    name: "GPT-4o",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    pricing: { currency: "USD", inputPer1M: 5, outputPer1M: 15 },
    capabilities: ["code_generation", "code_review", "vision", "function_calling"],
    aliases: ["gpt4o", "gpt-4o"],
    status: "active",
  },
  {
    id: "claude-sonnet-4",
    providerId: "anthropic",
    name: "Claude Sonnet 4",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: { currency: "USD", inputPer1M: 3, outputPer1M: 15 },
    capabilities: ["code_generation", "code_review", "planning", "vision"],
    aliases: ["sonnet", "claude-sonnet"],
    status: "active",
  },
  {
    id: "claude-opus-4",
    providerId: "anthropic",
    name: "Claude Opus 4",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: { currency: "USD", inputPer1M: 15, outputPer1M: 75 },
    capabilities: ["code_generation", "planning", "analysis"],
    aliases: ["opus", "claude-opus"],
    status: "active",
  },
  {
    id: "MiniMax-Text-01",
    providerId: "minimax",
    name: "MiniMax Text 01",
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    pricing: { 
      currency: "USD", 
      inputPer1M: 0.1, 
      outputPer1M: 0.5,
      batchInputPer1M: 0.01,
    },
    capabilities: ["code_generation", "function_calling"],
    aliases: ["minimax", "minimax-text"],
    status: "active",
  },
];
```

## 5. Query Algorithm

```ts
export function findModels(
  registry: ModelRegistry,
  filters: ModelFilters,
): ModelInfo[] {
  let models = registry.listActive();
  
  if (filters.providerId) {
    models = models.filter(m => m.providerId === filters.providerId);
  }
  
  if (filters.minContextWindow) {
    models = models.filter(m => m.contextWindow >= filters.minContextWindow!);
  }
  
  if (filters.maxCostPer1M !== undefined) {
    models = models.filter(m => 
      (m.pricing.inputPer1M + m.pricing.outputPer1M) <= filters.maxCostPer1M!
    );
  }
  
  if (filters.capabilities?.length) {
    models = models.filter(m =>
      filters.capabilities!.every(c => m.capabilities.includes(c))
    );
  }
  
  if (filters.status) {
    models = models.filter(m => m.status === filters.status);
  }
  
  return models.sort((a, b) => {
    const costA = a.pricing.inputPer1M + a.pricing.outputPer1M;
    const costB = b.pricing.inputPer1M + b.pricing.outputPer1M;
    return costA - costB;
  });
}
```

## 6. Cost Calculation

```ts
export function calculateCost(
  model: ModelInfo,
  inputTokens: number,
  outputTokens: number,
  options?: {
    useBatch?: boolean;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
): number {
  const base = (inputTokens / 1_000_000) * model.pricing.inputPer1M
    + (outputTokens / 1_000_000) * model.pricing.outputPer1M;
  
  let total = base;
  
  if (options?.useBatch && model.pricing.batchInputPer1M) {
    const batchSavings = (inputTokens / 1_000_000) 
      * (model.pricing.inputPer1M - model.pricing.batchInputPer1M);
    total -= batchSavings;
  }
  
  if (options?.cacheReadTokens && model.pricing.cacheReadPer1M) {
    total += (options.cacheReadTokens / 1_000_000) * model.pricing.cacheReadPer1M;
  }
  
  if (options?.cacheWriteTokens && model.pricing.cacheWritePer1M) {
    total += (options.cacheWriteTokens / 1_000_000) * model.pricing.cacheWritePer1M;
  }
  
  return Math.round(total * 100) / 100; // round to cents
}
```

## 7. Events

```ts
type ModelRegistryEvent =
  | { type: "model.registered"; providerId: string; modelId: string }
  | { type: "model.unregistered"; providerId: string; modelId: string }
  | { type: "model.status_changed"; providerId: string; modelId: string; status: string }
  | { type: "model.queried"; filters: ModelFilters; results: number };
```

## 8. Acceptance Criteria

- Models can be registered and unregistered
- Alias lookup works correctly
- Filters return correctly filtered and sorted results
- Cost calculation handles all pricing components
- Default models are loaded on initialization
- Status changes are tracked
- Events are emitted for all operations
- Unit tests cover all query scenarios
