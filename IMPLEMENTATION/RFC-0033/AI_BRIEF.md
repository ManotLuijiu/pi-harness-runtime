# RFC-0033 AI Brief: Session Manager

## Summary

A comprehensive session management system for tracking user sessions, maintaining conversation history, and providing session persistence.

## Implementation Overview

### Key Classes to Implement

1. **SessionManager** (`manager.ts`)
   - Session lifecycle (create, get, close, suspend, resume)
   - Message history management
   - Token accounting
   - Metrics collection

2. **SessionStore** (`store.ts`)
   - Session persistence to disk
   - Session indexing and retrieval
   - Auto-cleanup of expired sessions

3. **SessionPolicyEngine** (`policy.ts`)
   - Evaluate session limits
   - Token budget enforcement
   - Cost tracking

### Dependencies

- `packages/types` - for runtime-types
- `packages/checkpoint` - for session persistence
- `packages/quota-manager` - for cost tracking

### Files to Create

- `packages/session/src/manager.ts`
- `packages/session/src/store.ts`
- `packages/session/src/history.ts`
- `packages/session/src/policy.ts`
- `packages/session/src/metrics.ts`
- `packages/session/src/types.ts`
- `packages/session/src/index.ts`

### Integration Points

- Integrate with RuntimeApi for session CRUD endpoints
- Integrate with ContextWindowManager for token tracking
