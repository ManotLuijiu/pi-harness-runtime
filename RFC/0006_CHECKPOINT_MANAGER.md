# RFC 0006 - Checkpoint Manager

## Purpose
Persist and restore long-running AI coding jobs.

## Motivation
The runtime must survive provider quota exhaustion, process crashes, network failures, machine restarts, and manual pause without losing progress.

## Goals
- Save state after every important transition.
- Restore last known safe state.
- Support task-level and job-level recovery.
- Start local-first with JSON files.

## Non-goals
- Distributed consensus.
- Multi-user locking.
- Cloud checkpoint storage.

## Checkpoint Model
```json
{
  "version": 1,
  "jobId": "job_001",
  "status": "paused_quota",
  "requirement": "Build MiniMax quota resume",
  "currentTaskId": "task_003",
  "provider": "minimax",
  "resumeAt": "2026-07-01T20:30:00+07:00",
  "lastError": "MiniMax 2056 quota exhausted",
  "createdAt": "2026-07-01T15:20:00+07:00",
  "updatedAt": "2026-07-01T15:21:00+07:00"
}
```

## Storage Layout
```text
~/.pi-harness-runtime/jobs/<job_id>/
  checkpoint.json
  tasks.json
  events.jsonl
  resume_prompt.md
  last_error.log
```

## Interface
```ts
interface CheckpointManager {
  save(checkpoint: RuntimeCheckpoint): Promise<void>;
  load(jobId: string): Promise<RuntimeCheckpoint | null>;
  appendEvent(jobId: string, event: RuntimeEvent): Promise<void>;
}
```

## Recovery Strategy
Use atomic writes, append-only event logs, schema validation, and human escalation if state cannot be trusted.
