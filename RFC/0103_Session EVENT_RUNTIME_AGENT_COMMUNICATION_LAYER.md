# RFC-0103 — Session Event Runtime & Agent Communication Layer

> **Status:** Proposed  
> **Author:** pi-harness-runtime  
> **Replaces:** N/A  
> **Superseded by:** N/A

---

## Summary

The Session Event Runtime transforms pi session JSONL files into a real-time communication backbone for autonomous AI agents. JSONL remains the immutable event store — the event bus, projections, and subscriptions are built on top of it.

```
JSONL (immutable)
  v
Event Store
  v
Event Publisher
  v
Projection Engine
  v
Semantic Event Bus
  v
Agent Subscribers
  v
Workflow Automation
```

---

## Motivation

Current AI systems:

```
User -> Agent -> Response -> Done
```

This runtime:

```
User
  v
Master Planner
  v
Sub Agent
  v
Session Event Runtime
  v
Semantic Event Projection
  v
Event Bus
  v
Subscribers
  v
Next Agent
  v
Continuous Workflow
```

**No agent should poll session files. No agent should manually inspect JSONL. Every agent subscribes to semantic runtime events.**

---

## Existing Architecture (Do Not Redesign)

| Component | Package | RFC |
|---|---|---|
| JSONL Session Files | `~/.pi/sessions/` | — |
| Autonomous Runtime | `packages/autonomous-runtime/` | RFC-0101 |
| Context Engineering | `packages/context-compiler/` | RFC-0102 |

JSONL is the **immutable event store**. Never replace or redesign it.

---

## New Packages

```
packages/
  event-store/              # Layer 1 — Immutable JSONL wrapper
  event-bus/                # Layer 2 — Typed pub/sub
  projection-engine/         # Layer 3 — Semantic event projections
  workflow-events/           # Layer 4 — Semantic workflow events
  subscription-engine/        # Layer 5 — Agent subscription management
  session-api/               # Layer 6 — Safe API for agents
  session-export/            # Human export (markdown, JSON, text, HTML)
  clipboard/                 # /copy and /export commands
```

---

## Layer 1 — Event Store

### Responsibility

Wrap pi session JSONL files as a typed, searchable event store.

### Session File Location

`~/.pi/sessions/<sessionId>.jsonl`

### Session Event Schema

```typescript
interface SessionEvent {
  id: string;              // crypto.randomUUID()
  sessionId: string;
  timestamp: string;        // ISO 8601
  type: SessionEventType;
  role?: "user" | "assistant" | "system";
  content?: string;
  tool?: string;
  error?: string;
  metadata?: EventMetadata;
}

type SessionEventType =
  | "message"
  | "tool_start"
  | "tool_end"
  | "tool_error"
  | "assistant_start"
  | "assistant_end"
  | "session_start"
  | "session_end"
  | "checkpoint"
  | "compact";

interface EventMetadata {
  model?: string;
  provider?: string;
  tokens?: number;
  durationMs?: number;
}
```

### Operations

```typescript
class EventStore {
  constructor(sessionsDir?: string);

  // Append event to JSONL
  append(event: Omit<SessionEvent, 'id' | 'timestamp'>): Promise<SessionEvent>;

  // Read events with optional filtering
  read(opts?: {
    sessionId?: string;
    since?: string;      // ISO timestamp
    types?: SessionEventType[];
    limit?: number;
    offset?: number;
  }): Promise<SessionEvent[]>;

  // Full-text search on content
  search(opts: {
    sessionId?: string;
    query: string;
    limit?: number;
  }): Promise<SessionEvent[]>;

  // Statistics
  stats(sessionId: string): StoreStats;

  // List all session IDs
  list(): string[];

  // Get path for a session
  getPath(sessionId: string): string;
}
```

### JSONL Format

One JSON object per line, append-only.

```jsonl
{"id":"uuid","sessionId":"sess-001","timestamp":"2026-07-24T10:00:00Z","type":"message","role":"user","content":"fix the login bug"}
{"id":"uuid","sessionId":"sess-001","timestamp":"2026-07-24T10:00:01Z","type":"assistant_start","metadata":{"model":"MiniMax"}}
{"id":"uuid","sessionId":"sess-001","timestamp":"2026-07-24T10:00:02Z","type":"tool_start","tool":"read_file"}
```

---

## Layer 2 — Event Bus

### Responsibility

Typed pub/sub system for runtime events. Built on top of EventStore.

### Event Payload

```typescript
interface EventPayload<T> {
  topic: string;
  data: T;
  timestamp: string;
  eventId: string;
  source: string;         // agent ID or "system"
}
```

### Topics

```typescript
type Topic =
  // Session events
  | "session.message"
  | "session.assistant_start"
  | "session.assistant_end"
  | "session.tool_start"
  | "session.tool_end"
  | "session.checkpoint"
  | "session.compact"
  // Semantic events
  | "task.assigned"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "review.requested"
  | "review.completed"
  | "decision.made"
  | "approval.requested"
  | "approval.granted"
  | "workflow.started"
  | "workflow.finished"
  | "knowledge.extracted"
  // System events
  | "system.quota_exceeded"
  | "system.checkpoint_saved"
  | "system.error";
```

### Operations

```typescript
class EventBus {
  publish<T>(topic: string, data: T): string;  // returns eventId

  subscribe<T>(
    topic: string,
    subscriber: (payload: EventPayload<T>) => void | Promise<void>,
    filter?: (data: T) => boolean,
    priority?: number
  ): string;  // returns subscriptionId

  unsubscribe(subscriptionId: string): void;
  unsubscribeAll(topic?: string): void;

  // Replay historical events to new subscriber
  replay(topic: string, events: EventPayload<unknown>[]): void;
}
```

### Delivery Guarantee

`at_least_once` — default. Events are delivered at least once (subscribers may receive duplicates on recovery).

---

## Layer 3 — Projection Engine

### Responsibility

Transform raw SessionEvents into semantic views. Projections are derived — they never modify JSONL.

### Projections

#### Decision Projector

Detects architecture decisions from assistant messages:

- Contains "RFC", "ADR", "decision", "architecture", "design choice"
- Or explicit: "we will use X because Y"
- Output: `Decision[]`

#### Task Projector

Detects task state transitions:

- Tool calls matching `task-*` pattern
- Status changes in content
- Output: `TaskState[]`

#### Summary Projector

Rolling session summary:

- `messageCount` — total messages
- `toolCount` — tool invocations
- `decisionCount` — detected decisions
- `topics` — inferred from keywords
- `durationMs` — session duration
- Output: `SessionSummary`

#### Timeline Projector

Agent event timeline:

- Groups events by inferred agent
- Sorts by timestamp
- Output: `AgentTimeline[]`

### Operations

```typescript
class ProjectionEngine {
  constructor(eventStore?: EventStore);

  addEvent(event: SessionEvent): void;  // updates all projections

  getDecision(id: string): Decision | null;
  getDecisions(): Decision[];

  getTaskState(id: string): TaskState | null;
  getTaskStates(): TaskState[];

  getSummary(): SessionSummary;
  getTimeline(agentId?: string): AgentTimeline[];

  reset(): void;  // clear all projections
}
```

---

## Layer 4 — Semantic Workflow Events

### Responsibility

Define the vocabulary of semantic events that trigger workflow automation.

### Event Types

```typescript
type SemanticEvent =
  | TaskAssigned
  | TaskStarted
  | TaskCompleted
  | TaskFailed
  | ReviewRequested
  | ReviewCompleted
  | ArchitectureDecision
  | CodeGenerated
  | TestsPassed
  | TestsFailed
  | HumanApprovalRequested
  | HumanApprovalGranted
  | WorkflowFinished;

interface TaskAssigned {
  kind: "TaskAssigned";
  taskId: string;
  assignedTo: string;    // agent ID
  assignedBy: string;    // planner ID
  timestamp: string;
}

interface TaskStarted {
  kind: "TaskStarted";
  taskId: string;
  workerId: string;
  timestamp: string;
}

interface TaskCompleted {
  kind: "TaskCompleted";
  taskId: string;
  workerId: string;
  result: {
    delivered: boolean;
    files?: string[];
    summary?: string;
  };
  timestamp: string;
}

interface ReviewRequested {
  kind: "ReviewRequested";
  taskId: string;
  reviewer: string;       // agent ID
  rationale: string;
  timestamp: string;
}

interface ArchitectureDecision {
  kind: "ArchitectureDecision";
  id: string;
  decision: string;
  rationale: string;
  approved: boolean;
  timestamp: string;
}

interface HumanApprovalRequested {
  kind: "HumanApprovalRequested";
  taskId: string;
  rationale: string;
  requestedAt: string;
}

interface HumanApprovalGranted {
  kind: "HumanApprovalGranted";
  taskId: string;
  grantedBy: string;
  timestamp: string;
}
```

### Workflow State Machine

```typescript
class WorkflowStateMachine {
  transition(event: SemanticEvent): WorkflowTransition;
  getState(): WorkflowState;
  getHistory(): WorkflowTransition[];

  // States: idle | running | paused | finished
  // Transitions trigger semantic events
}
```

---

## Layer 5 — Subscription Engine

### Responsibility

Manage agent subscriptions to semantic events with predicate filtering.

### Operations

```typescript
class SubscriptionEngine {
  constructor(eventBus?: EventBus);

  // Subscribe to a topic with optional predicate filter
  subscribe(
    agentId: string,
    topic: string,
    predicate?: (event: unknown) => boolean,
    priority?: number
  ): string;  // returns subscriptionId

  unsubscribe(subscriptionId: string): void;
  unsubscribeAgent(agentId: string): void;  // remove all subscriptions for agent

  getSubscriptions(agentId?: string): TopicSubscription[];
  getAgents(): SubscriberInfo[];

  // Check which subscriptions match an event
  match<T>(topic: string, event: T): TopicSubscription<T>[];
}
```

### Example Subscriptions

| Agent | Topic | Predicate |
|---|---|---|
| Reviewer | `review.requested` | `e => e.taskId.includes('bug')` |
| MiniMax | `task.assigned` | `e => e.assignedTo === 'minimax'` |
| Planner | `*` (all) | none |
| Human | `approval.requested` | none |

---

## Layer 6 — Session API

### Responsibility

Safe API for agents to read session state without parsing JSONL directly.

```typescript
class SessionService {
  constructor(eventStore?: EventStore, projectionEngine?: ProjectionEngine);

  // Latest decision
  getLatestDecision(): Promise<Decision | null>;

  // Latest task
  getLatestTask(): Promise<TaskState | null>;

  // Recent failures
  getRecentFailures(limit?: number): Promise<SessionEvent[]>;

  // Architecture decisions
  getArchitectureHistory(): Promise<ArchitectureDecision[]>;

  // Current workflow
  getWorkflowState(): Promise<WorkflowState>;

  // Rolling summary
  getLatestSummary(): Promise<SessionSummary>;

  // Full-text search
  search(query: string): Promise<SessionEvent[]>;

  // Agent timeline
  getAgentTimeline(agentId: string): Promise<AgentTimeline>;

  // Session timeline
  getSessionTimeline(limit?: number): Promise<SessionEvent[]>;
}
```

---

## Human Commands

### `/copy last`

Copies the latest assistant message to system clipboard.

### `/export last`

Exports the latest assistant response to a file.

### `/summary`

Shows a rolling session summary (from Summary Projector).

---

## Export Formats

### Markdown

```markdown
# Session: sess-001
Duration: 15m 32s
Messages: 24
Tools: 18
Decisions: 3

## Timeline
10:00 — User: fix the login bug
10:01 — Assistant: Starting analysis...
10:02 — Tool: read_file(apps/auth/src/login.ts)
...
```

### JSON

Full structured export with events, decisions, tasks.

### Text

Plain text transcript.

### HTML

Styled HTML page for sharing.

---

## Integration with RFC-0102

```
ContextEngineering Pipeline
  -> SessionService.getLatestDecision()
  -> SessionService.getArchitectureHistory()
  -> SessionService.getRecentFailures()
  -> Build context from session state (NOT raw JSONL)
```

ContextEngineering NEVER reads JSONL directly. It goes through `SessionService`.

---

## Integration with RFC-0101

```
Autonomous Runtime
  -> EventStore.append() on every state change
  -> SemanticEventBuilder.buildFromSessionEvents()
  -> EventBus.publish("task.assigned", event)
  -> SubscriptionEngine.notify(agentId, event)
  -> Agent receives via subscription callback
```

Autonomous Runtime publishes lifecycle events:

- `WorkerStarted`
- `WorkerRecovered`
- `WorkerFailed`
- `CheckpointSaved`
- `TaskResumed`
- `QuotaExceeded`

---

## Failure Handling

| Scenario | Handling |
|---|---|
| Duplicate events | `at_least_once` delivery — subscriber deduplicates by `eventId` |
| Lost subscribers | EventStore retains all events — replay from last checkpoint |
| Worker crash | Recovery from last `checkpoint` event in JSONL |
| Replay interruption | Incremental replay from last processed `eventId` |
| Subscriber timeout | Subscription expires after 5 minutes idle; renew on activity |
| Large session | Paginated reads; streaming for >10,000 events |
| Corrupted JSONL | Skip malformed lines; log warning; continue |

---

## Files

See `IMPLEMENTATION/RFC-0103/FILES.md`.

---

## Acceptance Criteria

See `IMPLEMENTATION/RFC-0103/ACCEPTANCE_CRITERIA.md`.
