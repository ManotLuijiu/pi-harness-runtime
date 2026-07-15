# RFC-0015 — Job State Machine

## Status
Proposed

## Motivation

Jobs (one-shot autonomous coding tasks) need a well-defined lifecycle so the harness can track, checkpoint, resume, and expose status throughout execution.

## State Diagram

```
created → planning → queued → running → testing → e2e_testing
       → reviewing → repairing → paused_quota → waiting_human
       → ready_for_client → archived
```

## States

| State | Description |
|-------|-------------|
| `created` | Job submitted, not yet planned |
| `planning` | Master Planner decomposing requirement |
| `queued` | Waiting for scheduler slot |
| `running` | Actively executing tasks |
| `testing` | Unit/integration tests running |
| `e2e_testing` | End-to-end tests running |
| `reviewing` | Code review in progress |
| `repairing` | Auto-fix loop after review failure |
| `paused_quota` | Paused — quota exhausted |
| `waiting_human` | Paused — needs human approval |
| `ready_for_client` | Done — results available |
| `archived` | Retired from active list |

## Transitions

Every transition emits a `job.state_changed` event to the Event Bus. The Checkpoint Engine snapshots state before each transition for crash-recovery.

## Persistence

Job state is persisted to SQLite after every transition. On restart, the scheduler reloads `queued`, `paused_*`, and `waiting_human` jobs.

## Package

`packages/job-state-machine/`
