---
name: herdr
description: Start herdr agents for cross-agent communication via shared event bus. Human on the loop, not in the loop.
disable-model-invocation: true
argument-hint: "[start|status] [review|code]"
allowed-tools: Bash(bun *), Bash(ls *), Bash(cat *), Read
---

# Herdr Agent Communication

Start long-lived agents in herdr tabs that communicate via shared event bus.

## Architecture

```
Herdr Tab 1 (Minimax - Code Agent)
  └── publishes: code.written, review.requested
  └── subscribes: review.completed

Herdr Tab 2 (GPT - Review Agent)
  └── subscribes: code.written, review.requested
  └── publishes: review.completed
```

## Usage

### Terminal 1 - Start Code Agent
```bash
bun harness/herdr-agents.ts code
```

### Terminal 2 - Start Review Agent
```bash
bun harness/herdr-agents.ts review
```

### Check Status
```bash
bun harness/herdr-agents.ts status
```

## Workflow

1. **Code Agent** writes code -> publishes `code.written` event
2. **Review Agent** receives event -> auto-triggers review (no human needed)
3. **Review Agent** completes review -> publishes `review.completed` event
4. **Code Agent** receives completion -> continues work

## Event Types

| Event | Publisher | Data |
|-------|-----------|------|
| `code.written` | Code Agent | `{ taskId, files[], branch? }` |
| `review.requested` | Code Agent | `{ taskId, codeTaskId }` |
| `review.completed` | Review Agent | `{ taskId, reportFile, status }` |

## Shared Workspace

Events stored in `/tmp/herdr-workspace/`:
- `events.jsonl` - Append-only event log
- `payloads/` - Event payload files
- `subscriptions/` - Per-agent subscription markers

## Slash Commands

```
/herdr start review   # Start review agent
/herdr start code     # Start code agent
/herdr status         # Show workspace status
```

## Key Files

- `packages/event-bus/src/herdr-bus.ts` - HerdrEventBus implementation
- `harness/herdr-agents.ts` - CLI agents
- `harness/autonomous-review.ts` - Review automation logic
