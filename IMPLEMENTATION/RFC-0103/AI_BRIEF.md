# AI Brief — RFC-0103 Session Event Runtime & Agent Communication Layer

## What is being built

An 8-package system that transforms pi's JSONL session files into a real-time event bus for autonomous agents:

1. **event-store** — immutable JSONL wrapper: append, read, search, stats
2. **event-bus** — typed pub/sub with priority, filtering, replay
3. **projection-engine** — semantic views from raw events (decisions, tasks, summary, timeline)
4. **workflow-events** — semantic event vocabulary + state machine
5. **subscription-engine** — predicate-based agent subscriptions
6. **session-api** — safe read-only API (never parse JSONL directly)
7. **session-export** — markdown/JSON/text/HTML export
8. **clipboard** — /copy and /export commands

## Key interfaces

- `SessionEvent` — { id, sessionId, timestamp, type, role?, content?, tool?, metadata? }
- `EventPayload<T>` — { topic, data, timestamp, eventId, source }
- `SemanticEvent` — discriminated union: TaskAssigned/Started/Completed, ReviewRequested, ArchitectureDecision, etc.
- `EventBus` — publish(topic, data), subscribe(topic, fn, filter?, priority?)
- `SessionService` — getLatestDecision(), getRecentFailures(), search(), getSummary()

## Integration

- event-store reads/writes JSONL at `~/.pi/sessions/`
- event-bus uses Node.js EventEmitter internally
- projection-engine consumes SessionEvents, emits typed views
- subscription-engine wraps event-bus for predicate filtering
- session-api uses projection-engine + event-store for read operations
- autonomous-runtime (RFC-0101) publishes lifecycle events via event-bus
- context-engineering (RFC-0102) uses session-api for historical context

## Testing strategy

- event-store: mock temp JSONL file, test append/read/search
- event-bus: test pub/sub, priority ordering, filter, unsubscribe, replay
- projection-engine: test decision detection, task state, summary counts
- workflow-events: test state machine transitions
- Mock JSONL fixtures for CI

## Security

- No direct JSONL access from agents — must use SessionService
- Replay attack prevention via eventId deduplication
- Capability enforcement via SubscriptionEngine
