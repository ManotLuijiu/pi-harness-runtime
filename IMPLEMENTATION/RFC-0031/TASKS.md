# RFC-0031 Implementation Tasks

## Phase 1: SDK Foundation

- [ ] Create `packages/provider-adapter-sdk/` directory
- [ ] Set up package.json with dependencies
- [ ] Create `src/types.ts` with SDK types
- [ ] Create `src/errors.ts` with custom errors
- [ ] Create `src/index.ts` public exports

## Phase 2: Core Classes

- [ ] Implement `AdapterBuilder` class
  - [ ] Constructor with name parameter
  - [ ] `config()` method
  - [ ] `capabilities()` method
  - [ ] `models()` method
  - [ ] `rateLimits()` method
  - [ ] `invoke()` method
  - [ ] `parseError()` method
  - [ ] `build()` method
- [ ] Implement `AdapterRegistry` class
  - [ ] `register()` with lifecycle hooks
  - [ ] `unregister()` method
  - [ ] `getAdapter()` method
  - [ ] `listAdapters()` method
  - [ ] `healthCheckAll()` method
- [ ] Implement `AdapterTester` class
  - [ ] `testBasicInvocation()`
  - [ ] `testQuotaDetection()`
  - [ ] `testErrorParsing()`
  - [ ] `runAllTests()`

## Phase 3: Compatibility & Migration

- [ ] Implement version compatibility checks
- [ ] Migrate MiniMax adapter to SDK
- [ ] Migrate OpenAI adapter to SDK
- [ ] Migrate Claude adapter to SDK
- [ ] Add examples in `examples/` directory
- [ ] Write unit tests

## Phase 4: Documentation

- [ ] Write README.md
- [ ] Document all public APIs
- [ ] Add JSDoc comments
- [ ] Create migration guide
