# RFC-0114 — Checkpoint System

## Purpose

Persist runtime state for recovery and replay.

## Motivation

Long-running agent sessions need checkpoint/restore capability:

- Save state periodically
- Recover from crashes
- Replay execution for debugging

## Architecture

```text
Runtime State -> Checkpoint Manager -> JSON File
      |
      +-> Differ (incremental diffs)
      +-> Validator (schema validation)
```

## Key Components

### checkpoint-manager.ts

- JsonCheckpointManager (legacy)
- CheckpointEngine (new)

### differ.ts

- Calculate state diffs
- Incremental checkpoints

## Files

See `IMPLEMENTATION/RFC-0114/FILES.md`.

## Acceptance Criteria

- [ ] Save runtime state to disk
- [ ] Incremental diffs for large states
- [ ] Recovery from checkpoint
- [ ] Schema validation
