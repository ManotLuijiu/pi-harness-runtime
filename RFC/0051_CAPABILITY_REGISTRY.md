# RFC-0051 — Capability Registry

Status: Draft  
Target package: `packages/capability-registry`  
Depends on: RFC-0053 Model Registry

## 1. Problem

The runtime needs to know which capabilities each model and provider supports. Currently, capabilities are hardcoded. The Capability Registry provides a centralized, extensible system for tracking and querying model capabilities.

## 2. Capability Types

```ts
export type Capability =
  | "code_generation"
  | "code_review"
  | "planning"
  | "test_generation"
  | "e2e_testing"
  | "refactoring"
  | "analysis"
  | "debugging"
  | "documentation"
  | "vision"
  | "function_calling"
  | "json_mode"
  | "streaming";

export interface CapabilityProfile {
  capability: Capability;
  score: number; // 0-100, quality rating
  latency: "fast" | "medium" | "slow";
  contextWindow: number;
  maxOutputTokens: number;
}
```

## 3. Registry Interface

```ts
export interface CapabilityRegistry {
  register(providerId: string, modelId: string, capabilities: CapabilityProfile[]): void;
  unregister(providerId: string, modelId: string): void;
  getCapabilities(providerId: string, modelId: string): CapabilityProfile[];
  query(capability: Capability, requirements?: CapabilityQuery): ModelWithCapability[];
  listProviders(): string[];
  listModels(providerId: string): string[];
}

export interface CapabilityQuery {
  minScore?: number;
  maxLatency?: "fast" | "medium" | "slow";
  requiresContextWindow?: number;
  requiresMaxOutput?: number;
}

export interface ModelWithCapability {
  providerId: string;
  modelId: string;
  profile: CapabilityProfile;
}
```

## 4. Default Capabilities

```ts
export const DEFAULT_CAPABILITIES: Record<string, Record<string, CapabilityProfile[]>> = {
  "openai": {
    "gpt-4o": [
      { capability: "code_generation", score: 95, latency: "medium", contextWindow: 128000, maxOutputTokens: 16384 },
      { capability: "code_review", score: 90, latency: "medium", contextWindow: 128000, maxOutputTokens: 16384 },
      { capability: "vision", score: 95, latency: "medium", contextWindow: 128000, maxOutputTokens: 16384 },
      { capability: "function_calling", score: 95, latency: "medium", contextWindow: 128000, maxOutputTokens: 16384 },
    ],
  },
  "anthropic": {
    "claude-sonnet-4": [
      { capability: "code_generation", score: 95, latency: "fast", contextWindow: 200000, maxOutputTokens: 8192 },
      { capability: "code_review", score: 95, latency: "fast", contextWindow: 200000, maxOutputTokens: 8192 },
      { capability: "planning", score: 90, latency: "fast", contextWindow: 200000, maxOutputTokens: 8192 },
      { capability: "vision", score: 90, latency: "fast", contextWindow: 200000, maxOutputTokens: 8192 },
    ],
    "claude-opus-4": [
      { capability: "code_generation", score: 98, latency: "slow", contextWindow: 200000, maxOutputTokens: 8192 },
      { capability: "planning", score: 95, latency: "slow", contextWindow: 200000, maxOutputTokens: 8192 },
      { capability: "analysis", score: 95, latency: "slow", contextWindow: 200000, maxOutputTokens: 8192 },
    ],
  },
  "minimax": {
    "MiniMax-Text-01": [
      { capability: "code_generation", score: 85, latency: "fast", contextWindow: 1000000, maxOutputTokens: 8192 },
      { capability: "function_calling", score: 80, latency: "fast", contextWindow: 1000000, maxOutputTokens: 8192 },
    ],
  },
};
```

## 5. Query Algorithm

```ts
export function queryCapabilities(
  registry: CapabilityRegistry,
  capability: Capability,
  requirements?: CapabilityQuery,
): ModelWithCapability[] {
  const all = registry.getAllModelsWithCapability(capability);
  
  return all
    .filter(m => {
      if (requirements?.minScore && m.profile.score < requirements.minScore) return false;
      if (requirements?.maxLatency && LATENCY_RANK[m.profile.latency] > LATENCY_RANK[requirements.maxLatency]) return false;
      if (requirements?.requiresContextWindow && m.profile.contextWindow < requirements.requiresContextWindow) return false;
      if (requirements?.requiresMaxOutput && m.profile.maxOutputTokens < requirements.requiresMaxOutput) return false;
      return true;
    })
    .sort((a, b) => b.profile.score - a.profile.score);
}

const LATENCY_RANK = { fast: 1, medium: 2, slow: 3 };
```

## 6. Integration Points

- Provider Router uses Capability Registry to filter candidates
- Cost Optimizer uses capability profiles for model selection
- Task Compiler uses capabilities for task-to-model matching

## 7. Events

```ts
type CapabilityRegistryEvent =
  | { type: "capability.registered"; providerId: string; modelId: string; count: number }
  | { type: "capability.unregistered"; providerId: string; modelId: string }
  | { type: "capability.queried"; capability: Capability; results: number };
```

## 8. Acceptance Criteria

- Registry can register/unregister capabilities
- Query returns models sorted by score
- Latency and context window filters work correctly
- Default capabilities are loaded on initialization
- Events are emitted for all mutations
- Unit tests cover all query scenarios
