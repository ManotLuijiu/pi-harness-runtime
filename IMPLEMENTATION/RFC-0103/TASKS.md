# Tasks — RFC-0103 Session Event Runtime & Agent Communication Layer

## Phase 1 — event-store

- [ ] Create `packages/event-store/src/types.ts` — SessionEvent, SessionEventType, EventMetadata, StoreOptions, StoreStats, WriteResult, ReadOptions, SearchOptions
- [ ] Create `packages/event-store/src/store.ts` — EventStore class: append(), read(), search(), stats(), list(), getPath()
- [ ] Create `packages/event-store/src/index.ts` — public barrel
- [ ] Create `packages/event-store/test/store.test.ts` — bun test with temp dir JSONL
- [ ] Build and verify: `npx tsc -p packages/event-store/tsconfig.json --skipLibCheck`
- [ ] Run tests: `bun test packages/event-store/test/store.test.ts`

## Phase 2 — event-bus

- [ ] Create `packages/event-bus/src/types.ts` — Topic union, EventPayload, Subscriber, Subscription, BusOptions, EventBusError
- [ ] Create `packages/event-bus/src/bus.ts` — EventBus class: publish(), subscribe(), unsubscribe(), unsubscribeAll(), replay(), getSubscribers()
- [ ] Create `packages/event-bus/src/index.ts` — public barrel
- [ ] Create `packages/event-bus/test/bus.test.ts` — bun test: pub/sub, priority ordering, filter, unsubscribe, replay
- [ ] Build and verify
- [ ] Run tests

## Phase 3 — projection-engine

- [ ] Create `packages/projection-engine/src/types.ts` — Projection<T>, Decision, TaskState, KnowledgeExtraction, AgentTimeline, SessionSummary
- [ ] Create `packages/projection-engine/src/projections/decision-projector.ts` — detectArchitectureDecision(events): Decision[]
- [ ] Create `packages/projection-engine/src/projections/task-projector.ts` — detectTaskState(events): TaskState[]
- [ ] Create `packages/projection-engine/src/projections/summary-projector.ts` — buildSummary(events): SessionSummary
- [ ] Create `packages/projection-engine/src/projections/timeline-projector.ts` — buildTimeline(events): AgentTimeline[]
- [ ] Create `packages/projection-engine/src/engine.ts` — ProjectionEngine class: addEvent(), getDecision(), getDecisions(), getTaskState(), getTaskStates(), getSummary(), getTimeline(), reset()
- [ ] Create `packages/projection-engine/src/index.ts` — public barrel
- [ ] Create `packages/projection-engine/test/engine.test.ts` — bun test
- [ ] Build and verify
- [ ] Run tests

## Phase 4 — workflow-events

- [ ] Create `packages/workflow-events/src/types.ts` — SemanticEvent discriminated union (12 variants), WorkflowState, WorkflowTransition
- [ ] Create `packages/workflow-events/src/builder.ts` — SemanticEventBuilder: buildFromSessionEvents(), detectTaskAssigned(), detectTaskCompleted(), detectReviewRequested(), detectArchitectureDecision(), detectHumanApproval()
- [ ] Create `packages/workflow-events/src/workflow.ts` — WorkflowStateMachine: transition(), getState(), getHistory()
- [ ] Create `packages/workflow-events/src/index.ts` — public barrel
- [ ] Create `packages/workflow-events/test/workflow.test.ts` — bun test
- [ ] Build and verify
- [ ] Run tests

## Phase 5 — subscription-engine

- [ ] Create `packages/subscription-engine/src/types.ts` — Predicate<T>, TopicSubscription<T>, SubscriptionResult, SubscriberInfo
- [ ] Create `packages/subscription-engine/src/engine.ts` — SubscriptionEngine: subscribe(), unsubscribe(), unsubscribeAgent(), getSubscriptions(), getAgents(), match<T>()
- [ ] Create `packages/subscription-engine/src/index.ts` — public barrel
- [ ] Create `packages/subscription-engine/test/engine.test.ts` — bun test: predicate filtering
- [ ] Build and verify
- [ ] Run tests

## Phase 6 — session-api

- [ ] Create `packages/session-api/src/types.ts` — SessionService interface, SessionQuery
- [ ] Create `packages/session-api/src/api.ts` — SessionServiceImpl: getLatestDecision(), getLatestTask(), getRecentFailures(), getArchitectureHistory(), getWorkflowState(), getLatestSummary(), search(), getAgentTimeline(), getSessionTimeline()
- [ ] Create `packages/session-api/src/index.ts` — public barrel
- [ ] Create `packages/session-api/test/api.test.ts` — bun test with mock event store + projection engine
- [ ] Build and verify
- [ ] Run tests

## Phase 7 — session-export

- [ ] Create `packages/session-export/src/types.ts` — ExportFormat enum, ExportRequest, ExportResult
- [ ] Create `packages/session-export/src/exporter.ts` — SessionExporter: export(), toMarkdown(), toJson(), toText(), toHtml()
- [ ] Create `packages/session-export/src/index.ts` — public barrel
- [ ] Create `packages/session-export/test/export.test.ts` — bun test
- [ ] Build and verify
- [ ] Run tests

## Phase 8 — clipboard

- [ ] Create `packages/clipboard/src/types.ts` — ClipboardContent, ClipboardOptions
- [ ] Create `packages/clipboard/src/clipboard.ts` — copy(), read(), copyLastResponse() with /dev/clipboard fallback
- [ ] Create `packages/clipboard/src/index.ts` — public barrel
- [ ] Create `packages/clipboard/test/clipboard.test.ts` — bun test (mock)
- [ ] Build and verify
- [ ] Run tests

## Phase 9 — Integration

- [ ] Wire autonomous-runtime (RFC-0101) to publish events via event-bus
- [ ] Wire context-engineering (RFC-0102) to read session via session-api
- [ ] Verify all 8 packages build: `npx tsc` across all
- [ ] Verify all tests pass: `bun test packages/*/test/*.test.ts`

## Phase 10 — Documentation

- [ ] Write `packages/event-store/README.md`
- [ ] Write `packages/event-bus/README.md`
- [ ] Write `packages/projection-engine/README.md`
- [ ] Write `packages/workflow-events/README.md`
- [ ] Write `packages/subscription-engine/README.md`
- [ ] Write `packages/session-api/README.md`
- [ ] Write `packages/session-export/README.md`
- [ ] Write `packages/clipboard/README.md`
- [ ] Update root `README.md` with RFC-0103 reference
