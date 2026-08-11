---
description: Activate write-review loop - writer implements, reviewer checks, loop until approved
argument-hint: "<task description>"
---
# Write-Review Loop

Use the subagent tool with chain parameter:

```
/wr <task>
```

## How It Works

1. **Writer Agent** - Reads task, implements code, writes `## WRITER_DONE`
2. **Reviewer Agent** - Reads blackboard, reviews code quality
3. **Loop** - If changes requested, writer updates code
4. **Done** - When approved, writer can build/commit

## Status File

`{project}/.write-review/status.json` shows current phase:

- `idle` - No active review
- `writing` - Writer is implementing
- `reviewing` - Reviewer is evaluating
- `approved` - Ready to build/commit
- `changes_requested` - Writer needs to update

## Verdict Types

| Verdict | Meaning | Action |
|---------|---------|--------|
| APPROVED | Code is good | Build/commit |
| CHANGES_REQUESTED | Issues found | Update code |
| BLOCKED | Critical issues | Human help needed |

## Examples

```
/wr Create a React Button component
/wr Fix the login bug
/wr Add unit tests for auth module
```

## Prerequisites

- `.write-review/` directory in project
- `write-review` package installed
- Review agent configured in pi-harness-runtime
