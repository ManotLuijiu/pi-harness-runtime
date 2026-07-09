# @pi/session

Session management system for pi-harness-runtime with message history, token accounting, policy enforcement, and session persistence.

## Features

- **Session Lifecycle** - Create, suspend, resume, and close sessions
- **Message History** - Full conversation history with search capabilities
- **Token Accounting** - Track input/output tokens and costs per session
- **Policy Engine** - Rate limiting, budget enforcement, and session policies
- **Context Window** - Automatic management of context window size
- **Persistence** - Sessions stored to disk with auto-save
- **Event System** - Subscribe to session lifecycle events
- **Auto-Cleanup** - Automatic expiration and idle timeout handling

## Installation

```bash
npm install @pi/session
```

## Quick Start

### Basic Usage

```typescript
import { createSessionManager } from "@pi/session";

const manager = createSessionManager({
  rootDir: "./sessions",
  sessionTtlMs: 24 * 60 * 60 * 1000, // 24 hours
});

// Create a new session
const session = await manager.create("user-123", {
  project: "my-project"
});
console.log(`Created session: ${session.id}`);

// Add messages
const userMessage = await manager.addMessage(session.id, {
  role: "user",
  content: "Hello, how are you?",
  timestamp: new Date().toISOString(),
});

const assistantMessage = await manager.addMessage(session.id, {
  role: "assistant",
  content: "I'm doing well! How can I help you?",
  timestamp: new Date().toISOString(),
  tokens: 50,
});

// Get messages
const messages = await manager.getMessages(session.id);
console.log(`Session has ${messages.length} messages`);
```

### Session Lifecycle

```typescript
// Suspend a session
await manager.suspend(session.id, "User requested pause");

// Resume later
const resumed = await manager.resume(session.id);
console.log(`Session ${resumed?.status}`);

// Close session
await manager.end(session.id);
```

### Token Tracking

```typescript
// Update token usage
await manager.updateTokenUsage(session.id, {
  inputTokens: 1000,
  outputTokens: 500,
  inputCost: 0.01,
  outputCost: 0.005,
  totalCost: 0.015,
  totalTokens: 1500,
});

// Get metrics
const metrics = await manager.getMetrics(session.id);
console.log(`Total cost: $${metrics?.totalCost}`);
```

### Policy Enforcement

```typescript
import { createPolicyEngine } from "@pi/session";

const policy = createPolicyEngine({
  maxRequestsPerMinute: 60,
  maxCostPerSession: 10,
  sessionBudget: 5,
});

// Check if action is allowed
if (policy.canProceed(sessionId, "message")) {
  // Proceed with action
  policy.recordAction(sessionId, "message");
} else {
  const violation = policy.getViolationType(sessionId);
  console.log(`Policy violation: ${violation}`);
}
```

### Event System

```typescript
manager.on("session:created", (event) => {
  console.log(`Session created: ${event.sessionId}`);
});

manager.on("message:added", (event) => {
  console.log(`Message added to session: ${event.sessionId}`);
});

manager.on("policy:violation", (event) => {
  console.log(`Policy violation: ${event.data?.violation}`);
});

manager.on("budget:exceeded", (event) => {
  console.log(`Budget exceeded: $${event.data?.cost}`);
});
```

### Context Window Management

```typescript
// Get messages that fit in a token budget
const contextMessages = await manager.getMessagesForContext(
  session.id,
  4000 // Target tokens
);
console.log(`Got ${contextMessages.length} messages for 4k tokens`);
```

### Search Messages

```typescript
import { MessageSearch } from "@pi/session";

const search = new MessageSearch();
search.buildIndex(session.id, messages);

const results = search.search({
  sessionId: session.id,
  role: "user",
  contains: "help",
  limit: 10,
});

console.log(`Found ${results.length} matching messages`);
```

## API Reference

### SessionManager

```typescript
const manager = createSessionManager({
  rootDir: string;           // Session storage directory
  sessionTtlMs?: number;     // Session TTL (default: 24h)
  maxIdleMs?: number;       // Max idle before suspend (default: 30m)
  autoSaveIntervalMs?: number; // Auto-save interval (default: 5s)
  maxMessagesPerSession?: number; // Max messages (default: 1000)
  maxTokenBudget?: number;  // Token budget (default: 128000)
  enableMetrics?: boolean;   // Enable metrics (default: true)
  autoCleanup?: boolean;     // Auto-cleanup (default: true)
  cleanupIntervalMs?: number; // Cleanup interval (default: 1h)
});
```

### Methods

```typescript
// Create session
await manager.create(userId, metadata?): Promise<Session>;

// Get session summary
await manager.get(sessionId): Promise<Session | null>;

// Get full session context
await manager.getContext(sessionId): Promise<SessionContext | null>;

// End session
await manager.end(sessionId): Promise<void>;

// Suspend session
await manager.suspend(sessionId, reason): Promise<void>;

// Resume session
await manager.resume(sessionId): Promise<Session | null>;

// Add message
await manager.addMessage(sessionId, message): Promise<Message | null>;

// Get messages
await manager.getMessages(sessionId, options?): Promise<Message[]>;

// Get messages for context
await manager.getMessagesForContext(sessionId, targetTokens): Promise<Message[]>;

// Update token usage
await manager.updateTokenUsage(sessionId, usage): Promise<void>;

// Get metrics
await manager.getMetrics(sessionId): Promise<SessionMetrics | null>;

// List user sessions
await manager.listByUser(userId): Promise<Session[]>;

// Delete session
await manager.delete(sessionId): Promise<void>;

// Cleanup expired sessions
await manager.cleanup(): Promise<number>;

// Event listeners
manager.on(eventType, listener): void;
manager.off(eventType, listener): void;
```

### Event Types

```typescript
type SessionEventType =
  | "session:created"
  | "session:updated"
  | "session:closed"
  | "session:expired"
  | "session:suspended"
  | "session:resumed"
  | "message:added"
  | "policy:violation"
  | "budget:exceeded";
```

### Storage Format

Sessions are stored as JSON files:

```
sessions/
├── index.json                    # Session index
└── sessions/
    └── ab/
        └── cdef1234.../
            └── session.json      # Full session context
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SessionManager                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Manager   │  │   Policy    │  │     Store       │  │
│  │             │──│   Engine    │──│                 │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│         │                                      │        │
│         ▼                                      ▼        │
│  ┌─────────────────┐                ┌─────────────────┐│
│  │ ContextWindow   │                │    Disk         ││
│  │ Manager         │                │                 ││
│  └─────────────────┘                └─────────────────┘│
└─────────────────────────────────────────────────────────┘
```
