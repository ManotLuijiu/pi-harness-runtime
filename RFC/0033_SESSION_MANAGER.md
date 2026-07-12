# RFC 0033: Session Manager

## Summary

A comprehensive session management system for tracking user sessions, maintaining conversation history, and providing session persistence across restarts.

## Motivation

Currently, session state is managed ad-hoc within individual components. We need:

1. Centralized session tracking
2. Conversation history with token accounting
3. Session persistence and restoration
4. Multi-session support (parallel jobs)
5. Session metrics and analytics

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Session Manager                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   Session    │  │   History    │  │   Metrics    │             │
│  │   Store      │  │   Manager    │  │   Collector  │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   Session    │  │   Message    │  │   Context    │             │
│  │   Policy     │  │   Index      │  │   Cache      │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Session Types

```typescript
interface Session {
  id: string;
  userId?: string;
  jobId?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  expiresAt?: string;
  metadata: SessionMetadata;
  context: SessionContext;
}

type SessionStatus = 'active' | 'idle' | 'suspended' | 'closed';

interface SessionMetadata {
  provider: string;
  model: string;
  tokenUsage: TokenUsage;
  messageCount: number;
  turnCount: number;
  costEstimate: number;
  tags: string[];
}

interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

interface SessionContext {
  systemPrompt?: string;
  workingDirectory?: string;
  variables: Record<string, unknown>;
  attachments: Attachment[];
}
```

### 2. SessionManager Class

```typescript
interface SessionManagerConfig {
  storageDir: string;                // Where to persist sessions
  maxSessions: number;               // Max concurrent sessions
  sessionTimeout: number;            // Idle timeout in ms
  maxHistoryLength: number;          // Max messages to retain
  autoCheckpoint: boolean;           // Auto-save session state
  checkpointInterval: number;        // Checkpoint frequency in ms
}

class SessionManager {
  constructor(config: SessionManagerConfig);
  
  // Session lifecycle
  createSession(init?: Partial<Session>): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  closeSession(id: string): Promise<void>;
  suspendSession(id: string): Promise<void>;
  resumeSession(id: string): Promise<Session>;
  
  // Message handling
  addMessage(sessionId: string, message: Message): Promise<void>;
  getHistory(sessionId: string, options?: HistoryOptions): Promise<Message[]>;
  
  // Metrics
  getMetrics(sessionId: string): Promise<SessionMetrics>;
  getAllMetrics(): Promise<GlobalMetrics>;
  
  // Cleanup
  pruneSessions(olderThan: Date): Promise<PruneResult>;
  cleanupExpired(): Promise<CleanupResult>;
}
```

### 3. Message Types

```typescript
interface Message {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  tokens?: number;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
}

interface HistoryOptions {
  limit?: number;                    // Max messages to return
  before?: string;                   // Cursor for pagination
  roles?: ('system' | 'user' | 'assistant' | 'tool')[];
  search?: string;                  // Full-text search
}
```

### 4. Session Policy Engine

```typescript
interface SessionPolicy {
  maxTokensPerSession?: number;
  maxCostPerSession?: number;
  autoSuspendIdle?: boolean;
  idleTimeoutMs?: number;
  allowContextOverflow?: boolean;
  summarizationStrategy?: 'never' | 'when_near' | 'always';
}

class SessionPolicyEngine {
  constructor(policies: SessionPolicy[]);
  evaluate(session: Session): PolicyResult;
  apply(session: Session, result: PolicyResult): Promise<void>;
}
```

## File Structure

```
packages/session/
├── src/
│   ├── index.ts                    # Public exports
│   ├── manager.ts                  # SessionManager class
│   ├── store.ts                    # Session persistence
│   ├── history.ts                  # Message history management
│   ├── policy.ts                   # Policy engine
│   ├── metrics.ts                  # Metrics collection
│   ├── types.ts                    # Session types
│   └── errors.ts                   # Session errors
├── test/
│   ├── manager.test.ts
│   ├── history.test.ts
│   └── policy.test.ts
├── examples/
│   ├── basic-usage.ts
│   └── policy-examples.ts
├── package.json
└── README.md
```

## Usage Examples

### Creating and Using a Session

```typescript
const manager = new SessionManager({
  storageDir: './sessions',
  maxSessions: 100,
  sessionTimeout: 3600000, // 1 hour
  maxHistoryLength: 1000,
  autoCheckpoint: true
});

const session = await manager.createSession({
  userId: 'user-123',
  metadata: { provider: 'anthropic', model: 'claude-3-5-sonnet' }
});

await session.addMessage({
  role: 'user',
  content: 'Hello, help me build a React app'
});

const history = await session.getHistory({ limit: 10 });
```

### Policy Enforcement

```typescript
const policyEngine = new SessionPolicyEngine([
  { maxTokensPerSession: 100000 },
  { maxCostPerSession: 10.00 },
  { autoSuspendIdle: true, idleTimeoutMs: 300000 }
]);

const result = policyEngine.evaluate(session);
if (!result.allowed) {
  console.log(`Policy violation: ${result.reason}`);
  await session.suspend();
}
```

### Metrics

```typescript
const metrics = await session.getMetrics();
console.log({
  tokensUsed: metrics.tokenUsage.total,
  messages: metrics.messageCount,
  estimatedCost: metrics.costEstimate
});
```

## Integration with Existing Components

```
SessionManager ──────┬──────> CheckpointEngine (save/restore sessions)
                    │
                    ├──────> ContextWindowManager (token accounting)
                    │
                    ├──────> QuotaManager (cost tracking)
                    │
                    └──────> RuntimeApi (session CRUD endpoints)
```

## Acceptance Criteria

1. ✅ Sessions persist across process restarts
2. ✅ Message history is queryable with pagination
3. ✅ Token usage is accurately tracked per session
4. ✅ Policy engine enforces session limits
5. ✅ Idle sessions auto-suspend after timeout
6. ✅ Session metrics are available for analytics
7. ✅ Multiple concurrent sessions are supported

## Dependencies

- `packages/types` - for runtime-types
- `packages/checkpoint` - for session persistence
- `packages/quota-manager` - for cost tracking
- No new external dependencies
