# Pi Harness Runtime - Project State Report

**Generated:** 2026-07-06  
**Last Updated:** 2026-07-06

---

## Project Overview

Pi Harness Runtime is a local-first, provider-agnostic AI coding harness for pi.dev. It provides:

- Quota tracking and management
- Multi-provider support (MiniMax, OpenRouter, etc.)
- Job state machine with checkpoint/resume
- Task graph with dependency management
- Auto-compaction and continuation on output token limits
- Mobile notifications via Telegram/Ntfy/Webhook

---

## Directory Structure

```
pi-harness-runtime/
├── index.ts                    # Main CLI extension entry point
├── cli.ts                      # CLI commands
├── mirror.ts                   # Provider mirror store
├── renderer.ts                 # Status rendering
├── tracker.ts                  # Usage tracking
├── windows.ts                  # Windows aggregation
├── harness/                    # Core harness modules
│   ├── agent-handoff.ts       # Agent handoff protocol
│   ├── auto-compact.ts         # RFC-0019: Auto Compact
│   ├── blackboard.ts           # Shared blackboard
│   ├── context-window-manager.ts
│   ├── job-state-machine.ts    # Job state machine
│   ├── loop-runtime.ts         # RFC-0001: Main loop
│   ├── master-planner.ts       # Task planning
│   ├── notification-events.ts   # RFC-0022: Notification events
│   ├── output-limit-handler.ts # RFC-0020: Output limit
│   ├── partial-recovery.ts     # RFC-0021: Partial recovery
│   ├── repair-engine.ts        # Repair/retry logic
│   ├── task-graph.ts           # Task dependency graph
│   ├── e2e/                    # E2E test engine
│   └── project-detector/       # Project type detection
├── packages/
│   ├── auth/                   # Authentication
│   ├── checkpoint/             # Checkpoint manager
│   ├── notification/           # RFC-0022: Notification center
│   │   ├── notification-center.ts
│   │   ├── types.ts
│   │   ├── base-adapter.ts
│   │   └── adapters/
│   │       ├── telegram-adapter.ts
│   │       ├── ntfy-adapter.ts
│   │       ├── email-adapter.ts
│   │       └── webhook-adapter.ts
│   ├── provider-router/         # Provider routing
│   ├── providers/              # Provider adapters
│   ├── quota-manager/         # Quota tracking
│   ├── runtime/               # Runtime components (NEW)
│   ├── scheduler/             # Job scheduling
│   ├── shared-context/        # Shared context
│   ├── tui/                   # Terminal UI
│   ├── types/                 # Type definitions
│   └── worktree/              # Git worktree management
├── RFC/                       # RFC documents (0028 total)
├── IMPLEMENTATION/             # Implementation tracking
│   └── RFC-XXXX/              # Per-RFC implementation tracking
│       ├── AI_BRIEF.md
│       ├── TASKS.md
│       └── ACCEPTANCE_CRITERIA.md
├── schemas/                   # JSON schemas
├── profiles/                  # Provider profiles
└── test/                     # Tests
```

---

## RFC Status

### Completed Implementations

| RFC | Name | Status | File(s) |
| ----- | ------ | -------- | --------- |
| 0001 | Loop Runtime | ✅ Implemented | `harness/loop-runtime.ts` |
| 0002 | Provider Adapter | ✅ Implemented | `packages/providers/adapters.ts` |
| 0003 | Quota Manager | ✅ Implemented | `packages/quota-manager/` |
| 0004 | Playwright Adapter | ✅ Implemented | `packages/providers/` |
| 0005 | Git Worktree | ✅ Implemented | `packages/worktree/` |
| 0006 | Checkpoint Manager | ✅ Implemented | `packages/checkpoint/` |
| 0007 | Scheduler | ✅ Implemented | `packages/scheduler/` |
| 0008 | Provider Router | ✅ Implemented | `packages/provider-router/` |
| 0009 | Shared Context | ✅ Implemented | `packages/shared-context/` |
| 0010 | Context Window Manager | ✅ Implemented | `harness/context-window-manager.ts` |
| 0011 | Shared Blackboard | ✅ Implemented | `harness/blackboard.ts` |
| 0012 | Agent Handoff Protocol | ✅ Implemented | `harness/agent-handoff.ts` |
| 0013 | E2E Test Engine | ✅ Implemented | `harness/e2e/` |
| 0014 | Project Detector | ✅ Implemented | `harness/project-detector/` |
| 0015 | Job State Machine | ✅ Implemented | `harness/job-state-machine.ts` |
| 0016 | Task Graph | ✅ Implemented | `harness/task-graph.ts` |
| 0017 | Master Planner | ✅ Implemented | `harness/master-planner.ts` |
| 0018 | Repair Engine | ✅ Implemented | `harness/repair-engine.ts` |
| 0019 | Auto Compact and Continue | ✅ Implemented | `harness/auto-compact.ts` |
| 0020 | Output Token Limit Handler | ✅ Implemented | `harness/output-limit-handler.ts` |
| 0021 | Partial Response Recovery | ✅ Implemented | `harness/partial-recovery.ts` |
| 0022 | Notification Center | ✅ Implemented | `packages/notification/` |
| 0023 | Local Browser Agent | 🔲 Stub Only | - |

### Stubs (Need Implementation)

| RFC | Name | Status |
| ----- | ------ | -------- |
| 0024 | Local Runtime Agent | ✅ Implemented - `packages/runtime/local-runtime-agent.ts` |
| 0025 | Command Executor | ✅ Implemented - `packages/runtime/command-executor.ts` |
| 0026 | Workspace Manager | ✅ Implemented - `packages/runtime/workspace-manager.ts` |
| 0027 | Runtime API | ✅ Implemented - `packages/runtime/runtime-api.ts` |
| 0028 | Policy Engine | ✅ Implemented - `packages/runtime/policy-engine.ts` |

---

## Key Implementation Patterns

### 1. RFC Document Structure

Each RFC in `/RFC/` follows this format:

```markdown
# RFC-XXXX - Title

## Purpose
## Motivation  
## Goals
## Artifact Layout (file structure)
## Runtime Flow (state diagram)
## Acceptance Criteria
```

### 2. Implementation Tracking

Each RFC in `/IMPLEMENTATION/RFC-XXXX/` contains:

- `AI_BRIEF.md` - Brief description of what to implement
- `TASKS.md` - Task list (Read RFC, Implement, Test)
- `ACCEPTANCE_CRITERIA.md` - Success criteria

### 3. Class Naming Convention

- **Core Engine:** `[Name]Engine` or `[Name]Manager`
  - Example: `AutoCompactEngine`, `JobStateMachine`, `TaskGraphManager`
- **Runtime:** `[Name]Runtime`
  - Example: `LoopRuntime`, `LocalRuntimeAgent`
- **Adapter:** `[Name]Adapter` extends `BaseChannelAdapter`
  - Example: `TelegramAdapter`, `NtfyAdapter`
- **Handler:** `[Name]Handler`
  - Example: `OutputLimitHandler`, `PartialRecovery`

### 4. TypeScript Conventions

- Uses ESM (`import/export`)
- JSDoc comments for documentation
- Interfaces for public APIs, types for unions
- Error handling with typed errors
- Async/await pattern for I/O

### 5. File Paths

- Harness modules: `harness/[module-name].ts`
- Package modules: `packages/[name]/[module-name].ts`
- Adapters: `packages/notification/adapters/[name]-adapter.ts`

---

## Configuration

### Environment Variables

```
# Provider
MINIMAX_API_KEY=
OPENROUTER_API_KEY=

# Notification
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
NTFY_TOPIC=
NTFY_SERVER=https://ntfy.sh
NTFY_TOKEN=
NOTIFICATION_WEBHOOK_URL=
NOTIFICATION_WEBHOOK_METHOD=POST

# Paths
PI_USAGE_DIR=~/.pi/usage-status
PI_HARNESS_DIR=~/.pi/harness
```

### Runtime Storage

- **Usage tracking:** `~/.pi/usage-status/`
- **Harness state:** `~/.pi/harness/[jobId]/`
  - `checkpoint.json` - Job checkpoint
  - `context/` - Compaction artifacts
  - `partial/` - Partial responses
  - `events.jsonl` - Event log

---

## Event Types (RFC-0022)

```typescript
type NotificationEvent =
  | "JobStarted"
  | "TaskCompleted"
  | "TaskFailed"
  | "QuotaPaused"
  | "ResumeScheduled"
  | "ContextCompacted"
  | "OutputLimitContinued"
  | "E2EFailed"
  | "HumanReviewNeeded"
  | "ReadyForClient"
  | "JobCancelled"
  | "Error";
```

---

## State Machine States

```
pending -> planning -> running <-> repairing <-> testing <-> reviewing
    |         |          |              |            |
    v         v          v              v            v
 cancelled  paused   waiting_human   paused_quota  ready_for_client
```

---

## ✅ IMPLEMENTED: RFCs 0024-0028

### RFC-0024: Local Runtime Agent ✅

**File:** `packages/runtime/local-runtime-agent.ts`

- HTTP server for quota checking
- Coordinates with Local Browser Agent (RFC-0023)
- Security: redact sensitive data, localhost binding

### RFC-0025: Command Executor ✅

**File:** `packages/runtime/command-executor.ts`

- Safe shell command execution
- Timeout, output capture
- Security policies with allowlist/denylist

### RFC-0026: Workspace Manager ✅

**File:** `packages/runtime/workspace-manager.ts`

- Workspace directory management
- Worktree lifecycle
- Automatic cleanup policies

### RFC-0027: Runtime API ✅

**File:** `packages/runtime/runtime-api.ts`

- HTTP/RPC API for runtime control
- Job management endpoints
- WebSocket support for real-time events

### RFC-0028: Policy Engine ✅

**File:** `packages/runtime/policy-engine.ts`

- Command execution policies
- Network access policies
- Rate limiting & audit logging

---

## Provider Usage Data

See: `harness/reports/PROVIDER_USAGE_RESEARCH.md`

| Provider | Method | Status |
| ---------- | -------- | -------- |
| MiniMax | Browser scraping | 🔄 Testing |
| OpenAI (GPT) | TUI parsing | ✅ Implemented |
| GLM (Zhipu) | TUI parsing | ✅ Implemented |

### Unified Approach

All providers use TUI message parsing (except MiniMax which needs browser).
No API keys needed - hooks into pi's error/status messages.

---

## Dependencies

```json
{
  "dependencies": {
    "node:fs": "built-in",
    "node:path": "built-in",
    "node:os": "built-in",
    "node:http": "built-in",
    "node:events": "built-in",
    "ws": "WebSocket support"
  }
}
```

---

## Testing

Test files located in `/test/`:

- Unit tests for core modules
- Integration tests for state machine
- E2E test engine in `harness/e2e/`

---

## Next Steps

1. ~~Complete RFC-0024~~ - Local Runtime Agent ✅
2. ~~Implement RFC-0025~~ - Command Executor ✅
3. ~~Implement RFC-0026~~ - Workspace Manager ✅
4. ~~Implement RFC-0027~~ - Runtime API ✅
5. ~~Implement RFC-0028~~ - Policy Engine ✅
6. ~~Update index.ts~~ - Package exports ✅

### New Priority Items

1. **Implement OpenAI billing API** usage fetcher
2. **Research GLM** usage API
3. Debug MiniMax browser scraping
4. Add acceptance tests for RFC-0024-0028
