# RFC 0019 - Auto Compact and Continue

## Purpose

Automatically resume work after model/session compaction without requiring the human to type `resume`.

## Motivation

Observed behavior:

```text
[compaction]
Compacted from 201,419 tokens
Error: Model stopped because it reached the maximum output token limit.
```

Compaction is not completion. The runtime must own continuation.

## Goals

- Detect compaction markers from logs/output.
- Save compaction artifacts.
- Generate `continue_prompt.md`.
- Continue the same task without repeating completed work.
- Keep the human out of the message-bus role.

## Artifact Layout

```text
harness/context/
  compaction_events.jsonl
  latest_compaction_summary.md
  continue_prompt.md
```

## Runtime Flow

```text
AgentRunning
  -> CompactionDetected
  -> SaveCompactionArtifact
  -> GenerateContinuePrompt
  -> ContinueSameTask
  -> ValidateExpectedOutput
```

## Acceptance Criteria

- Runtime detects compaction.
- Runtime writes continuation prompt.
- Agent can continue without human typing `resume`.
