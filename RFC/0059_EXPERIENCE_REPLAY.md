# RFC-0059 — Experience Replay

## 1. Purpose

Experience Replay reconstructs prior runtime execution from persisted events, checkpoints, prompts, outputs, and evaluation evidence. It supports debugging, regression analysis, and reproducibility.

Replay is read-only by default.

## 2. Inputs

```ts
export interface ReplayRequest {
  jobId: string;
  mode: "inspect" | "simulate" | "reexecute";
  fromSequence?: number;
  toSequence?: number;
  allowExternalCalls: boolean;
}
```

## 3. Outputs

```ts
export interface ReplayResult {
  jobId: string;
  reconstructedState: JobStateSnapshot;
  timeline: ReplayEvent[];
  divergences: ReplayDivergence[];
  artifacts: string[];
}
```

## 4. Modes

### Inspect

Rebuilds state without executing tasks or provider calls.

### Simulate

Runs deterministic runtime transitions using recorded inputs but no external model/provider calls.

### Reexecute

Runs selected steps again. This mode requires explicit approval and isolated worktree.

## 5. Replay Sources

```text
checkpoint.json
events.jsonl
task-graph.json
prompt packages
agent reports
test results
evaluation results
repair attempts
OKF knowledge references
```

## 6. Determinism

A replay records divergence when:

- Source file hash differs.
- Project rules changed.
- Provider output differs.
- Test environment changed.
- Required artifact is missing.
- Runtime version differs.

## 7. Safety

Replay must never:

- Re-run destructive commands without approval.
- Modify the original worktree.
- Reuse expired credentials.
- Send notifications as if replay were live.
- Mark original tasks complete.

## 8. Runtime Events

```ts
type ReplayRuntimeEvent =
  | { type: "replay.started"; jobId: string; mode: string }
  | { type: "replay.state.reconstructed"; jobId: string; sequence: number }
  | { type: "replay.divergence.detected"; jobId: string; reason: string }
  | { type: "replay.completed"; jobId: string };
```

## 9. Tests

- Reconstructs state from event log.
- Detects changed source hash.
- Inspect mode performs no writes.
- Reexecute mode requires approval.
- Original task state remains unchanged.
- Missing artifact creates divergence entry.

## 10. Acceptance Criteria

- Replay can reconstruct any checkpointed job.
- Inspect mode is strictly read-only.
- Divergences are explicit.
- Reexecution is isolated.
- Original job data is immutable.
