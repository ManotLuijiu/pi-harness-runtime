# Plan: Herdr Inter-Agent Automation

## Context

- **herdr** (https://github.com/ogulcancelik/herdr) = tmux-like terminal multiplexer for pi sessions
- Each herdr tab = separate pi process = **isolated in-memory EventBus**
- **Current gap**: No cross-process communication. Agents in different tabs cannot communicate.
- **Goal**: Auto-trigger code review when Minimax finishes, send results back — human is "on the loop, not in the loop"

## Existing Architecture (Don't Redesign)

| Component | File | Status |
|-----------|------|--------|
| EventBus (in-memory pub/sub) | `packages/event-bus/src/bus.ts` | Built |
| SharedBlackboard (file-based) | `harness/blackboard.ts` | Built |
| Event types | `packages/event-bus/src/types.ts` | Built |
| Runtime types | `packages/types/src/runtime-types.ts` | Built |
| JSONL session files | `~/.pi/sessions/` | Built |

## Solution: Shared Event Log + Polling

```
~/.pi-harness-runtime/
  shared-events/
    events.jsonl         # Shared JSONL — all tabs read/write
    subscriptions.json   # Agent subscriptions (who wants what)
    locks/               # File-based locks (prevent race conditions)
```

Every herdr tab reads from and writes to the **same shared JSONL file**. No server needed.

## Architecture

```
[Minimax Tab]                           [GPT Tab]
    |                                     |
    | write code                          |
    | appendSharedEvent()                 |
    | {type:"code.generated", files:[...]} |
    |                                     |
    |                        pollSharedEvents() every 5s
    |                        sees "code.generated"
    |                        auto-trigger: /review <files>
    |                        writes code review
    |                        appendSharedEvent()
    |                        {type:"review.completed", report}
    |                                     |
    | pollSharedEvents() every 5s          |
    | sees "review.completed"             |
    | integrate feedback                   |
    | done                                |
```

## Implementation Phases

### Phase 1: Shared Event Log (`harness/shared-event-log.ts`)

```typescript
// appends to ~/.pi-harness-runtime/shared-events/events.jsonl
appendSharedEvent(event: SharedEvent): Promise<void>

// reads new events since last seen (by line number or timestamp)
readSharedEvents(since?: string): Promise<SharedEvent[]>

// file-based lock for safe concurrent writes
acquireLock(name: string, ttlMs?: number): Promise<boolean>
releaseLock(name: string): void
```

**SharedEvent schema:**
```typescript
interface SharedEvent {
  id: string;          // crypto.randomUUID()
  timestamp: string;   // ISO 8601
  source: string;      // "minimax-tab", "gpt-tab", "claude-tab"
  type: string;        // "code.generated", "review.requested", etc.
  data: unknown;       // event-specific payload
  sessionId?: string;  // pi session that generated this
  jobId?: string;      // harness job ID
}
```

### Phase 2: Auto-Poll Worker (`harness/auto-poll-worker.ts`)

```typescript
class AutoPollWorker {
  constructor(agentId: string, interests: string[]);

  start(intervalMs?: number): void;   // poll every N seconds
  stop(): void;

  // override this to handle events
  onEvent(event: SharedEvent): Promise<void>;
}
```

### Phase 3: Herdr Tab Coordinator

Each herdr tab runs a coordinator:

```
Tab 1 (Minimax):   Coordinator + main work
Tab 2 (GPT):       Coordinator only → auto-trigger /review
Tab 3 (Claude):    Coordinator only → auto-trigger /analyze
```

**Coordinator responsibilities:**
1. Poll shared events every 5 seconds
2. Match against subscriptions
3. Auto-trigger workflow commands
4. Publish results back to shared log

### Phase 4: Auto-Review Workflow

When `code.generated` event is detected:

```typescript
// Auto-trigger in GPT tab
if (event.type === "code.generated") {
  const files = event.data.files as string[];
  await runCommand(`/review ${files.join(" ")}`);
  // Write review to shared log
  appendSharedEvent({
    type: "review.completed",
    data: { taskId: event.data.taskId, report: reviewText }
  });
}
```

### Phase 5: Human-in-the-Loop (Minimal)

- Agent writes to shared log → human sees in TUI summary
- Human can inject commands via `harness/commands/inject.ts`
- Human can override with `/pause` command

## Key Design Decisions

### 1. JSONL over SQLite
- Simpler, human-readable, git-diff friendly
- Each line is one event — easy to tail, grep, debug

### 2. Polling over WebSockets
- Herdr = separate processes, no shared memory
- Polling (5s default) is fine for human-on-the-loop
- No server needed

### 3. File-based locking
- Use `flock` or write-to-lock-file pattern
- Prevent concurrent writes from multiple tabs

### 4. Subscription by type
- Each tab registers interests: `["code.generated", "review.requested"]`
- Only processes matching events

## Files to Create

```
harness/
  shared-event-log.ts        # Phase 1
  shared-event-types.ts       # SharedEvent interface
  auto-poll-worker.ts        # Phase 2
  coordinator/
    index.ts                 # Base coordinator
    minimax-coordinator.ts   # Tab 1 (does work + publishes)
    gpt-coordinator.ts       # Tab 2 (auto-review)
    claude-coordinator.ts    # Tab 3 (auto-analyze)
  commands/
    inject.ts                # Human command injection
    status.ts                # Show shared event status
```

## Integration Points

| Existing | Integration |
|----------|-------------|
| `harness/loop-runtime.ts` | Call `appendSharedEvent()` on state transitions |
| `harness/blackboard.ts` | Extend to write to shared log |
| `packages/event-bus` | Wrap in-process EventBus around shared log |
| `scripts/herdr-setup.ts` | Script to bootstrap herdr tabs with coordinators |

## Acceptance Criteria

1. Minimax tab writes `code.generated` event → GPT tab detects it within 10s
2. GPT tab auto-runs `/review` and writes `review.completed` event
3. Human sees summary in TUI — no manual intervention needed
4. Multiple tabs can poll simultaneously without corruption
5. Events are durable — survive tab crash/restart
6. No new npm dependencies — use Node.js built-ins only

## Next Steps

1. Create `harness/shared-event-types.ts` — define SharedEvent interface
2. Create `harness/shared-event-log.ts` — append/read/lock JSONL
3. Create `harness/auto-poll-worker.ts` — polling base class
4. Create `harness/coordinator/index.ts` — coordinator base
5. Create `harness/coordinator/gpt-coordinator.ts` — auto-review
6. Create `scripts/herdr-setup.ts` — bootstrap script
7. Write tests
8. Update RFC-0103 with herdr integration
