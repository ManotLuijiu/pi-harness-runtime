# RFC 0021 - Partial Response Recovery

## Purpose

Persist and recover incomplete agent outputs.

## Motivation

Partial output may contain useful plan, code, tests, or reports. It must not be discarded.

## Artifact Layout

```text
harness/partial/
  task_004/
    partial_001.md
    partial_002.md
    merged.md
    recovery_status.json
```

## Recovery Status

```json
{
  "task_id": "task_004",
  "status": "continuing",
  "partials": ["partial_001.md"],
  "merged_output": "merged.md",
  "attempts": 1,
  "last_error": "output token limit"
}
```

## Merge Strategy

v0.1 merges partials as ordered markdown sections.

Future:
- JSON-aware merge
- patch-aware merge
- code-block extraction
- semantic duplicate removal

## Acceptance Criteria

- Runtime never loses partial response text.
- Runtime can continue from partial output.
- Runtime escalates after repeated partial failures.
