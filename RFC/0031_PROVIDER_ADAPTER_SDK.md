# RFC 0031: Provider Adapter SDK

## Summary

A comprehensive SDK for building, testing, and registering provider adapters that normalize AI provider behavior.

## Motivation

The current adapter system is ad-hoc with adapters defined in `packages/providers/adapters.ts`. We need:

1. A standardized SDK for creating new adapters
2. Built-in testing utilities
3. Version management and compatibility checks
4. Clear extension points for custom adapters

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Provider Adapter SDK                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Builder   │  │  Registry   │  │   Tester    │         │
│  │   Class     │  │   Manager   │  │  Utilities  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│                    Adapter Interface                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ MiniMax     │  │  OpenAI     │  │  Claude     │         │
│  │ Adapter     │  │  Adapter    │  │  Adapter    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. AdapterBuilder Class

```typescript
class AdapterBuilder<T extends ProviderAdapter> {
  constructor(name: string);
  config(config: ProviderConfig): AdapterBuilder<T>;
  capabilities(...caps: ProviderCapability[]): AdapterBuilder<T>;
  models(...models: string[]): AdapterBuilder<T>;
  rateLimits(limits: RateLimitConfig): AdapterBuilder<T>;
  invoke(fn: (req: ProviderRequest) => Promise<ProviderResponse>): AdapterBuilder<T>;
  parseError(fn: (err: unknown) => ErrorAnalysis): AdapterBuilder<T>;
  build(): T;
}
```

### 2. AdapterTester Utility

```typescript
class AdapterTester {
  constructor(adapter: ProviderAdapter);
  testBasicInvocation(): Promise<TestResult>;
  testQuotaDetection(): Promise<TestResult>;
  testErrorParsing(): Promise<TestResult>;
  testRateLimiting(): Promise<TestResult>;
  generateMockResponses(): void;
}
```

### 3. Adapter Registry with Lifecycle

```typescript
interface AdapterLifecycle {
  onInit?: () => Promise<void>;
  onHealthCheck?: () => Promise<HealthStatus>;
  onTeardown?: () => Promise<void>;
}

class AdapterRegistry {
  register(adapter: ProviderAdapter, lifecycle?: AdapterLifecycle): void;
  unregister(id: string): void;
  getAdapter(id: string): ProviderAdapter | undefined;
  listAdapters(): ProviderAdapterInfo[];
  healthCheckAll(): Promise<Map<string, HealthStatus>>;
}
```

### 4. SDK Version Compatibility

```typescript
interface AdapterVersion {
  sdk: string; // "1.0.0"
  minRuntime: string;
  capabilities: ProviderCapability[];
}
```

## File Structure

```
packages/provider-adapter-sdk/
├── src/
│   ├── index.ts                    # Public exports
│   ├── builder.ts                  # AdapterBuilder class
│   ├── registry.ts                 # AdapterRegistry with lifecycle
│   ├── tester.ts                   # AdapterTester utilities
│   ├── types.ts                    # SDK-specific types
│   ├── compatibility.ts             # Version checks
│   └── errors.ts                   # SDK-specific errors
├── test/
│   ├── builder.test.ts
│   ├── registry.test.ts
│   └── tester.test.ts
├── examples/
│   ├── custom-provider.ts          # Example custom adapter
│   └── testing-adapter.ts          # Example testing setup
├── package.json
└── README.md
```

## Usage Examples

### Creating a Custom Adapter

```typescript
import { AdapterBuilder, type ProviderAdapter } from '@pi/provider-adapter-sdk';

const myAdapter = new AdapterBuilder('myprovider')
  .config({
    id: 'myprovider',
    name: 'My Custom Provider',
    models: ['myprovider/model-x', 'myprovider/model-y'],
    capabilities: ['code', 'review'],
    rateLimits: { requestsPerMinute: 60 }
  })
  .invoke(async (req) => {
    const response = await myApi.call(req);
    return response;
  })
  .parseError((err) => {
    return {
      quotaExceeded: err.code === 'QUOTA_EXCEEDED',
      rateLimited: err.code === 'RATE_LIMIT',
      // ...
    };
  })
  .build();
```

### Testing an Adapter

```typescript
const tester = new AdapterTester(myAdapter);
const results = await tester.runAllTests();

if (results.failed > 0) {
  console.log('Failed:', results.failures);
}
```

## Acceptance Criteria

1. ✅ SDK provides AdapterBuilder for creating adapters
2. ✅ SDK includes AdapterTester for validation
3. ✅ AdapterRegistry supports lifecycle hooks
4. ✅ Version compatibility checks prevent mismatches
5. ✅ All existing adapters (MiniMax, OpenAI, Claude) work with SDK
6. ✅ Custom adapters can be registered and used seamlessly
7. ✅ SDK exports TypeScript types and documentation

## Dependencies

- `packages/types` - for runtime-types
- `packages/providers` - existing adapter implementations
- No new external dependencies
