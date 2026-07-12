# RFC-0031 AI Brief: Provider Adapter SDK

## Summary

A comprehensive SDK for building, testing, and registering provider adapters that normalize AI provider behavior for MiniMax, OpenAI, Claude, and custom providers.

## Implementation Overview

### Key Classes to Implement

1. **AdapterBuilder** (`builder.ts`)
   - Fluent API for creating adapters
   - Configurable capabilities, models, rate limits
   - Invoke and parseError function registration

2. **AdapterRegistry** (`registry.ts`)
   - Lifecycle hooks (init, healthCheck, teardown)
   - Adapter versioning and compatibility
   - Factory pattern support

3. **AdapterTester** (`tester.ts`)
   - Test basic invocation
   - Test quota detection
   - Test error parsing
   - Generate mock responses

### Dependencies

- `packages/types` - for runtime-types
- `packages/providers` - existing adapters to migrate

### Files to Create

- `packages/provider-adapter-sdk/src/builder.ts`
- `packages/provider-adapter-sdk/src/registry.ts`
- `packages/provider-adapter-sdk/src/tester.ts`
- `packages/provider-adapter-sdk/src/types.ts`
- `packages/provider-adapter-sdk/src/compatibility.ts`
- `packages/provider-adapter-sdk/src/errors.ts`
- `packages/provider-adapter-sdk/src/index.ts`

### Integration Points

- Migrate existing adapters from `packages/providers/adapters.ts`
- Register with RuntimeApi for provider management
