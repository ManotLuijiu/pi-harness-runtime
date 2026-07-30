# Acceptance Criteria — RFC-0103 Session Event Runtime

## Functional

- [ ] EventStore.append() generates id + timestamp, appends JSONL line
- [ ] EventStore.read() returns events filtered by sessionId, since, types, limit
- [ ] EventStore.search() returns events matching text query
- [ ] EventStore.stats() returns totalEvents, sizeBytes, lastEventAt
- [ ] EventStore.list() returns all session IDs from ~/.pi/sessions/
- [ ] EventBus.publish() returns eventId, notifies all matching subscribers
- [ ] EventBus.subscribe() returns subscriptionId, sorted by priority (higher first)
- [ ] EventBus.subscribe() with filter only notifies when filter(data) returns true
- [ ] EventBus.unsubscribe() removes subscription, no further notifications
- [ ] EventBus.replay() delivers historical events to new subscriber
- [ ] ProjectionEngine.addEvent() updates all projections
- [ ] ProjectionEngine.getDecisions() returns detected architecture decisions
- [ ] ProjectionEngine.getSummary() returns messageCount, toolCount, decisionCount, topics
- [ ] SemanticEventBuilder.buildFromSessionEvents() converts SessionEvents to SemanticEvents
- [ ] WorkflowStateMachine.transition() advances state based on semantic event
- [ ] SubscriptionEngine.subscribe() creates subscription with predicate
- [ ] SubscriptionEngine.match() returns all subscriptions whose predicate matches
- [ ] SessionService.getLatestDecision() returns most recent decision
- [ ] SessionService.search() returns matching events from event-store
- [ ] SessionExporter.toMarkdown() generates readable markdown with timeline
- [ ] SessionExporter.toJson() generates structured JSON export
- [ ] Clipboard.copy() writes text to system clipboard
- [ ] Clipboard.read() reads from system clipboard
- [ ] /copy last — copies latest assistant message via clipboard
- [ ] /export last — exports latest response via session-export

## Non-Functional

- [ ] All 8 packages compile with zero TypeScript errors
- [ ] All tests pass: `bun test packages/*/test/*.test.ts`
- [ ] event-store handles corrupted JSONL lines gracefully (skip + warn)
- [ ] event-bus handles subscriber crash gracefully (remove dead subscriber)
- [ ] projection-engine handles empty events array gracefully
- [ ] clipboard gracefully handles unavailable clipboard (fallback message)
- [ ] SessionService never reads JSONL directly — always through event-store

## Integration

- [ ] autonomous-runtime (RFC-0101) publishes WorkerStarted, TaskAssigned, TaskCompleted via EventBus
- [ ] context-engineering (RFC-0102) reads session via SessionService.getRecentFailures()
- [ ] JSONL format preserved — same format as existing pi session files
