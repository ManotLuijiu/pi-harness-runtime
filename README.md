# Pi Harness Runtime

[![Beta](https://img.shields.io/badge/version-beta-orange?style=for-the-badge)](https://github.com/ManotLuijiu/pi-harness-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-macOS%20|Linux-blue?style=for-the-badge)]()

> ⚠️ **⚠️ Beta Notice — Not Production Ready ⚠️**
> This project is in active development. Core features work but E2E testing is not yet implemented.
> **148+ downloads** and counting — we appreciate the interest! Help us test by filing issues.

**Autonomous AI coding harness for pi: local token tracking + provider mirror + task orchestration.**

## Two Flavors

### 1. `/usage` — Token Tracking (stable ✅)

Codex-style usage tracking with local tokens + provider mirror.

### 2. `/harness` — Autonomous Coding Loop (beta 🔨)

Give the runtime a requirement. It keeps working, survives interruption, and returns with code ready for review.

## Install

```bash
pi install npm:pi-harness-runtime
```

Requires Pi v0.37.3+.

## Usage Commands

```bash
/usage           # show full status (local tracking + provider mirror)
/usage sync      # mirror provider quota from console.minimax.io
/usage today     # today's usage + 5h window
/usage week      # this week's usage + lifetime totals
/usage reset     # clear provider mirror
```

## Harness Commands

```bash
/harness start <requirement>   # Start a new harness job (beta)
/harness status               # Show current job status
/harness tasks                # List all tasks
/harness pause                # Pause when quota low
/harness resume               # Resume after quota reset
/harness cancel               # Cancel job
```

## Example Session

```
/harness start Build a REST API with JWT authentication

# Runtime creates task graph:
# task-001: Analyze requirements → ready
# task-002: Implement API → depends on task-001
# task-003: Write tests → depends on task-002
# task-004: Code review → depends on task-003

/harness status
# Job: job-123, Status: running
# Tasks: 1/4 done, 1 running

# When quota runs low:
/harness pause
# Job paused. Resume when quota resets.

# When quota resets:
/harness resume
# Job resumed. Continue working.

# When all tasks complete:
/harness status
# Job: job-123, Status: ready_for_client
# Tasks: 4/4 done ✓
```

## Architecture

```
pi-harness-runtime/
├── index.ts                    # Extension entry point
├── harness/
│   ├── job-state-machine.ts   # 14-state lifecycle machine
│   ├── task-graph.ts           # DAG-based task management
│   ├── master-planner.ts       # Requirement → task graph
│   ├── loop-runtime.ts         # Core execution loop
│   ├── repair-engine.ts        # Auto-fix failures
│   ├── blackboard.ts           # Agent coordination
│   ├── context-window-manager.ts # Context tracking
│   ├── agent-handoff.ts        # Clean agent transitions
│   ├── e2e/
│   │   ├── test-engine.ts     # E2E test runner (coming soon)
│   │   └── playwright-runner.ts # Browser automation
│   └── project-detector/
│       └── detector.ts         # Auto-detect project type
├── packages/
│   ├── providers/adapters.ts   # MiniMax, OpenAI adapters
│   ├── quota-manager/          # Quota signal collection
│   └── worktree/              # Git worktree per task
└── skills/
    └── harness-runtime/
        └── SKILL.md           # Skill documentation
```

## Job State Machine

```
created → planning → queued → running → testing → reviewing
    ↓        ↓         ↓        ↓         ↓
cancelled  blocked   waiting_human  repairing  ready_for_client
                                        ↓            ↓
                                  paused_quota    archived
```

## Key Features

- **Resumable**: Every state change is checkpointed to disk
- **Quota-aware**: Detects quota exhaustion, pauses, resumes after reset
- **Provider-agnostic**: MiniMax, OpenAI, Claude adapters
- **Task DAG**: Dependencies tracked, topological execution
- **Auto-repair**: Failure classification + retry with exponential backoff
- **E2E testing**: Scenario-based Playwright integration (coming soon)
- **Project detection**: Auto-detects Frappe, Next.js, React, Django, Laravel

## Data Directory

All data stored locally in `~/.pi/`:

```
~/.pi/
├── usage-status/         # /usage data
│   ├── usage.jsonl
│   └── mirror.json
└── harness/            # /harness data
    └── jobs/
        └── <job-id>/
            ├── checkpoint.json
            ├── events.jsonl
            ├── task-graph.json
            ├── blackboard/
            └── repair-tasks.jsonl
```

## Safety Properties

- ✅ **Local-first**: All data stays on disk
- ✅ **No credentials stored**: No passwords, tokens, or cookies
- ✅ **Human-on-the-loop**: Clear intervention points
- ✅ **Checkpointed**: Resume from any state
- ✅ **Idempotent**: Safe to run multiple times

## Testing

```bash
bun test   # 131+ tests passing
```

## Roadmap

- [x] Core harness infrastructure (job state machine, task graph)
- [x] Master planner
- [x] Repair engine
- [x] Shared blackboard
- [ ] E2E test engine integration
- [ ] MiniMax Web automatic quota detection
- [ ] Claude adapter
- [ ] Production stress testing

## License

MIT © 2026 MooCoding

## Related

- [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) — Underlying pi agent
- [context-mode](https://github.com/MiniMax-AI/context-mode) — Context window tracking
- [pi-web-access](https://github.com/nicobailon/pi-web-access) — Web search for pi
