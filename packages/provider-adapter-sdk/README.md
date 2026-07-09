# Provider Adapter SDK

A comprehensive SDK for building, testing, and registering AI provider adapters.

## Features

- **Fluent Builder API**: Create adapters with a clean, chainable interface
- **Lifecycle Management**: Initialize, activate, and teardown adapters
- **Health Checks**: Automatic health monitoring for adapters
- **Testing Utilities**: Built-in testing framework for adapters
- **Registry**: Centralized management of multiple adapters
- **Error Handling**: Comprehensive error parsing and quota detection

## Installation

```bash
npm install @pi/provider-adapter-sdk
```

## Quick Start

### Creating an Adapter

```typescript
import {
  AdapterBuilder,
  type ProviderRequest,
  type ProviderResponse,
} from "@pi/provider-adapter-sdk";

const adapter = new AdapterBuilder("My Provider")
  .id("my-provider")
  .name("My Custom AI Provider")
  .models("myai/model-x", "myai/model-y")
  .capabilities("code", "review")
  .rateLimits({
    requestsPerMinute: 60,
    tokensPerMinute: 100000,
  })
  .invoke(async (request: ProviderRequest): Promise<ProviderResponse> => {
    // Your API call here
    const response = await fetch("https://api.example.com/v1/completions", {
      method: "POST",
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
      }),
    });
    return response.json();
  })
  .parseError((error) => ({
    quotaExceeded: error.code === "QUOTA_EXCEEDED",
    rateLimited: error.status === 429,
    timeout: error.status === 408,
    serverError: error.status >= 500,
    clientError: error.status >= 400 && error.status < 500,
  }))
  .build();
```

### Using the Registry

```typescript
import { AdapterRegistry } from "@pi/provider-adapter-sdk";

const registry = new AdapterRegistry();

// Register adapter
await registry.register(adapter, {
  async onInit() {
    console.log("Adapter initialized");
  },
});

// Invoke adapter
const result = await registry.invoke("my-provider", {
  model: "myai/model-x",
  messages: [{ role: "user", content: "Hello!" }],
});

// List adapters
const adapters = registry.listAdapters();
console.log(`Registered ${adapters.length} adapters`);
```

### Testing Adapters

```typescript
import { AdapterTester } from "@pi/provider-adapter-sdk";

const tester = new AdapterTester(adapter, {
  mockResponses: true,
  testInvocation: true,
  testQuotaDetection: true,
  testErrorParsing: true,
  testHealthCheck: true,
});

const report = await tester.runAllTests();

console.log(`Tests: ${report.summary.passed}/${report.summary.total} passed`);
```

## API Reference

### AdapterBuilder

Fluent API for creating provider adapters.

```typescript
new AdapterBuilder(name?: string)
  .id(id: string)              // Required: unique adapter ID
  .name(name: string)           // Required: display name
  .models(...models: string[])  // Required: supported models
  .defaultModel(model: string)  // Default model
  .capabilities(...caps)        // Capabilities (code, review, etc.)
  .rateLimits(limits)           // Rate limit configuration
  .maxTokens(model, tokens)     // Max tokens per model
  .invoke(fn)                   // Required: invocation function
  .parseError(fn)               // Error parser function
  .healthCheck(fn)              // Health check function
  .build()                      // Build the adapter
```

### AdapterRegistry

Central registry for managing adapters.

```typescript
const registry = new AdapterRegistry({
  autoHealthCheck: true,
  healthCheckInterval: 30000,
});

// Methods
await registry.register(adapter, lifecycle?);
await registry.unregister(id);
registry.getAdapter(id);
registry.listAdapters();
registry.listByCapability(capability);
await registry.invoke(id, request);
await registry.healthCheck(id);
await registry.healthCheckAll();
registry.getStats();
```

### AdapterTester

Testing utilities for adapters.

```typescript
const tester = new AdapterTester(adapter, config);

await tester.runAllTests();
await tester.testBasicInvocation(request);
await tester.testQuotaDetection();
await tester.testErrorParsing();
await tester.testHealthCheck();
tester.generateMockResponses();
```

## Capabilities

Supported provider capabilities:

- `code` - Code generation
- `review` - Code review
- `plan` - Planning
- `test` - Test generation
- `e2e` - End-to-end testing
- `refactor` - Code refactoring
- `analysis` - Code analysis
- `debug` - Debugging assistance

## Error Handling

The SDK provides comprehensive error parsing:

```typescript
const analysis = adapter.parseError(error);
// analysis.quotaExceeded - Quota exceeded
// analysis.rateLimited - Rate limited
// analysis.timeout - Request timed out
// analysis.serverError - Server error
// analysis.clientError - Client error
```

## Migration Guide

### From Old Adapter Pattern

If you're migrating from the old adapter pattern:

```typescript
// Old pattern
class MyAdapter extends BaseProviderAdapter {
  readonly id = "my-provider";
  async invoke(request) { ... }
}

// New pattern (recommended)
const adapter = new AdapterBuilder("My Provider")
  .id("my-provider")
  .models("my-model")
  .invoke(async (request) => { ... })
  .build();
```

## Examples

See `examples/custom-adapter.ts` for complete examples:

- Basic adapter creation
- Registry usage
- Adapter testing
- Error handling
- Migration from existing adapters

## License

MIT
