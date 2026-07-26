# Files — RFC-0103 Session Event Runtime & Agent Communication Layer

## New Packages

```
packages/
├── event-store/
│   ├── src/
│   │   ├── types.ts         # SessionEvent, SessionEventType, EventMetadata,
│   │   │                      # StoreOptions, StoreStats, WriteResult,
│   │   │                      # ReadOptions, SearchOptions
│   │   ├── store.ts          # EventStore class — append/read/search/stats/list
│   │   └── index.ts          # Public barrel
│   ├── test/
│   │   └── store.test.ts    # bun test — temp JSONL file
│   ├── package.json
│   └── tsconfig.json
│
├── event-bus/
│   ├── src/
│   │   ├── types.ts          # Topic, EventPayload, Subscriber, Subscription,
│   │   │                      # BusOptions, EventBusError
│   │   ├── bus.ts            # EventBus class — Map-based pub/sub + EventEmitter
│   │   └── index.ts          # Public barrel
│   ├── test/
│   │   └── bus.test.ts       # bun test — pub/sub, priority, filter, replay
│   ├── package.json
│   └── tsconfig.json
│
├── projection-engine/
│   ├── src/
│   │   ├── types.ts          # Projection, Decision, TaskState,
│   │   │                      # KnowledgeExtraction, AgentTimeline,
│   │   │                      # SessionSummary
│   │   ├── engine.ts          # ProjectionEngine class — addEvent, projections
│   │   ├── projections/
│   │   │   ├── decision-projector.ts   # detectArchitectureDecision()
│   │   │   ├── task-projector.ts      # detectTaskState()
│   │   │   ├── summary-projector.ts   # buildSummary()
│   │   │   └── timeline-projector.ts # buildTimeline()
│   │   └── index.ts          # Public barrel
│   ├── test/
│   │   └── engine.test.ts    # bun test — projections
│   ├── package.json
│   └── tsconfig.json
│
├── workflow-events/
│   ├── src/
│   │   ├── types.ts          # SemanticEvent discriminated union (12 variants),
│   │   │                      # WorkflowState, WorkflowTransition
│   │   ├── builder.ts        # SemanticEventBuilder — buildFromSessionEvents()
│   │   ├── workflow.ts       # WorkflowStateMachine — transition(), getState()
│   │   └── index.ts          # Public barrel
│   ├── test/
│   │   └── workflow.test.ts # bun test — transitions
│   ├── package.json
│   └── tsconfig.json
│
├── subscription-engine/
│   ├── src/
│   │   ├── types.ts          # Predicate<T>, TopicSubscription<T>,
│   │   │                      # SubscriptionResult, SubscriberInfo
│   │   ├── engine.ts          # SubscriptionEngine — subscribe/unsubscribe/match
│   │   └── index.ts          # Public barrel
│   ├── test/
│   │   └── engine.test.ts    # bun test — predicate filtering
│   ├── package.json
│   └── tsconfig.json
│
├── session-api/
│   ├── src/
│   │   ├── types.ts          # SessionService interface, SessionQuery
│   │   ├── api.ts            # SessionServiceImpl — getLatestDecision(),
│   │   │                      # getRecentFailures(), search(), getSummary()
│   │   └── index.ts          # Public barrel
│   ├── test/
│   │   └── api.test.ts       # bun test — mock event store
│   ├── package.json
│   └── tsconfig.json
│
├── session-export/
│   ├── src/
│   │   ├── types.ts          # ExportFormat, ExportRequest, ExportResult
│   │   ├── exporter.ts        # SessionExporter — toMarkdown(), toJson(),
│   │   │                      # toText(), toHtml()
│   │   └── index.ts          # Public barrel
│   ├── test/
│   │   └── export.test.ts    # bun test — formats
│   ├── package.json
│   └── tsconfig.json
│
└── clipboard/
    ├── src/
    │   ├── types.ts          # ClipboardContent, ClipboardOptions
    │   ├── clipboard.ts       # copy(), read(), copyLastResponse()
    │   └── index.ts          # Public barrel
    ├── test/
    │   └── clipboard.test.ts # bun test — mock
    ├── package.json
    └── tsconfig.json
```

## Integration

| Source | Import from |
|---|---|
| Session JSONL path | `~/.pi/sessions/` — convention |
| SessionService | `session-api` — used by `context-engineering` |
| Event Bus | `event-bus` — used by `workflow-events`, `subscription-engine` |
| Semantic Events | `workflow-events` — used by `autonomous-runtime` (RFC-0101) |

## Dependencies

- `event-store` — standalone, no dependencies
- `event-bus` — uses `crypto.randomUUID()`, no dependencies
- `projection-engine` — uses `event-store` (or mock)
- `workflow-events` — uses `event-store` (or mock)
- `subscription-engine` — uses `event-bus` (or mock)
- `session-api` — uses `event-store` + `projection-engine`
- `session-export` — uses `session-api`
- `clipboard` — uses `session-api`; fallback: `/dev/clipboard` on Linux
