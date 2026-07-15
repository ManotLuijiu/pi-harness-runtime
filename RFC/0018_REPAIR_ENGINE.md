# RFC-0018 — Repair Engine

## Status
Proposed

## Motivation

When a task fails, the Repair Engine automatically generates repair tasks with retry policies and escalation paths.

## Flow

1. Task reports failure with error context
2. Repair Engine classifies failure type (test, lint, build, runtime, network)
3. For each classification, generate repair tasks:
   - **Test failure** → re-run with verbose output, fix test or fix code
   - **Build failure** → fix compilation error, re-run build
   - **Runtime failure** → add error handling, retry
   - **Network failure** → retry with backoff
4. Escalate to human if max retries exceeded

## Retry Policy

```ts
interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  jitter: boolean;
}
```

Default: 3 attempts, exponential backoff starting at 1000ms.

## Package

`packages/repair-engine/`
