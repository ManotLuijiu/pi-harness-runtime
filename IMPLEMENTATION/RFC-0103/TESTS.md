# Tests — RFC-0103 Session Event Runtime

## event-store

### Unit Tests

| Test | Setup | Expected |
|---|---|---|
| append generates id | empty temp dir | event.id is valid UUID |
| append generates timestamp | empty temp dir | event.timestamp is ISO string |
| append writes JSONL line | empty temp dir | file contains one JSON line |
| read by sessionId | 2 sessions in dir | returns only matching session |
| read with since filter | events before/after timestamp | returns only after |
| read with type filter | message + tool events | returns only matching types |
| read with limit | 10 events | returns at most 10 |
| search by content | events with "error" | returns matching events |
| search query case-insensitive | events with "Error" | returns matching |
| stats returns count | 5 events | totalEvents = 5 |
| list sessions | 2 session files | returns 2 IDs |
| handles corrupt line | JSONL with invalid JSON | skips line, warns |

## event-bus

### Unit Tests

| Test | Setup | Expected |
|---|---|---|
| publish returns eventId | subscribe then publish | returns UUID string |
| subscriber receives event | subscribe + publish | subscriber called with payload |
| multiple subscribers | 3 subscribers, one topic | all 3 called |
| unsubscribe removes subscriber | subscribe, unsubscribe, publish | subscriber not called |
| unsubscribeAll removes all | subscribe to 2 topics, unsubscribeAll | no subscribers |
| priority ordering | 2 subscribers, priority 1 and 2 | priority 2 called first |
| filter predicates | subscribe with filter, matching event | subscriber called |
| filter predicates | subscribe with filter, non-matching event | subscriber NOT called |
| replay delivers history | subscribe, replay([events]) | subscriber called for each |
| topic wildcard | subscribe("*") | receives all events |
| duplicate topic subscribe | subscribe same topic twice | 2 subscriptions, 2 calls |
| subscriber crash | subscriber throws | other subscribers still called |

## projection-engine

### Unit Tests

| Test | Input | Expected |
|---|---|---|
| decision detection | assistant message with "RFC" | Decision.kind = "ArchitectureDecision" |
| decision detection | assistant message with "decision: use X" | Decision detected |
| task state detection | tool event with "task-id" | TaskState with correct id |
| summary counts messages | 5 message events | messageCount = 5 |
| summary counts tools | 3 tool events | toolCount = 3 |
| summary infers topics | messages with "deploy" keyword | topics includes "deployment" |
| timeline groups by agent | events from 2 agents | 2 AgentTimeline entries |
| reset clears all | add events, reset() | all projections empty |
| empty events array | [] | graceful, empty results |

## workflow-events

### Unit Tests

| Test | Input | Expected |
|---|---|---|
| build TaskAssigned | SessionEvent type="task_assigned" | SemanticEvent.kind = "TaskAssigned" |
| build TaskCompleted | SessionEvent type="task_completed" | SemanticEvent.kind = "TaskCompleted" |
| build ReviewRequested | SessionEvent with "review" content | SemanticEvent.kind = "ReviewRequested" |
| state machine idle->running | TaskStarted event | state.status = "running" |
| state machine running->finished | WorkflowFinished event | state.status = "finished" |
| history records transitions | 3 transitions | history.length = 3 |

## subscription-engine

### Unit Tests

| Test | Setup | Expected |
|---|---|---|
| subscribe returns id | subscribe agent to topic | returns UUID string |
| unsubscribe by id | subscribe, unsubscribe | subscription removed |
| unsubscribeAgent removes all | agent subscribed to 2 topics | all removed |
| getSubscriptions by agent | 2 agents subscribed | returns only that agent's |
| match returns predicates | predicate returns true | subscription in match results |
| match filters | predicate returns false | subscription NOT in match results |
| priority passed through | subscribe with priority 5 | stored with priority 5 |

## session-api

### Unit Tests

| Test | Setup | Expected |
|---|---|---|
| getLatestDecision | 2 decisions in store | returns most recent |
| getRecentFailures | 3 failure events | returns 3 |
| search | query "login" | returns matching events |
| getSummary | mixed events | returns SessionSummary |
| getAgentTimeline | events from agent-1 | returns AgentTimeline for agent-1 |

## session-export

### Unit Tests

| Test | Input | Expected |
|---|---|---|
| toMarkdown has header | events | starts with "# Session" |
| toMarkdown has timeline | events | contains timestamps |
| toJson is valid JSON | events | JSON.parse succeeds |
| toText is plain text | events | no markdown formatting |
| export with format=markdown | events | content starts with # |
| export with format=json | events | content is JSON |
| eventCount in result | 5 events | eventCount = 5 |

## clipboard

### Unit Tests

| Test | Setup | Expected |
|---|---|---|
| copy writes text | text "hello" | no error thrown |
| read returns string | clipboard has text | returns string |
| copyLastResponse gets latest | sessionApi with messages | latest assistant message copied |
