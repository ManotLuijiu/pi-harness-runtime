# RFC-0033 Implementation Tasks

## Phase 1: Session Core

- [ ] Create `packages/session/` directory
- [ ] Define `Session`, `SessionMetadata`, `SessionContext` types
- [ ] Create `SessionManager` class
- [ ] Implement `createSession()`
- [ ] Implement `getSession()`
- [ ] Implement `closeSession()`

## Phase 2: Lifecycle & State

- [ ] Implement `suspendSession()`
- [ ] Implement `resumeSession()`
- [ ] Implement `listSessions()`
- [ ] Add session timeout handling
- [ ] Implement auto-suspend for idle sessions

## Phase 3: Message History

- [ ] Create `Message` types
- [ ] Implement `addMessage()`
- [ ] Implement `getHistory()` with pagination
- [ ] Add full-text search support
- [ ] Implement history pruning

## Phase 4: Policy & Metrics

- [ ] Create `SessionPolicyEngine`
- [ ] Implement token budget evaluation
- [ ] Implement cost tracking
- [ ] Create `getMetrics()` method
- [ ] Implement `getAllMetrics()`

## Phase 5: Persistence

- [ ] Create `SessionStore` class
- [ ] Implement session serialization
- [ ] Implement session restoration
- [ ] Implement `pruneSessions()`
- [ ] Implement `cleanupExpired()`

## Phase 6: Integration

- [ ] Integrate with RuntimeApi
- [ ] Integrate with ContextWindowManager
- [ ] Write integration tests
- [ ] Performance benchmarks
