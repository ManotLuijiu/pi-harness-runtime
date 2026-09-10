---
description: Local-first, provider-agnostic AI coding harness runtime for pi.dev with quota management and multi-model coordination
---

# Harness Runtime — pi Extension

## CRITICAL: Todo List Rule

**When you identify 2+ tasks, issues, or jobs — add ALL of them to the Todo list immediately.**

Do NOT just list them in text. Use the `todo` tool to create tracked tasks:

```bash
# Creating multiple tasks at once
bd create "Fix initialRemotionData not defined" -p 2
bd create "Fix dictionary.title undefined" -p 2
bd create "Replace Film icon with themed icon" -p 2
```

**Rule**: If you write something like:

- "There are 3 issues: ..."
- "I found several problems: ..."
- "Let me fix these: 1) X 2) Y 3) Z"
- "Here are the tasks to do: ..."

**Then you MUST create Todo items for each one.** Single-issue fixes don't need tracking.

**Why**: Agents often identify issues verbally but forget to track them. This rule ensures nothing slips through.

## Remote Server Commands (SSH)

**ALWAYS use detached SSH pattern to prevent long hangs.**

### Anti-Pattern (blocks SSH, hangs indefinitely)
```bash
# WRONG - SSH blocks waiting for background process
ssh user@host "kill old; sleep 2; uvicorn ... &"
# SSH never returns because it waits for uvicorn
```

### Correct Pattern (fast exit, process stays on server)
```bash
# CORRECT - SSH exits fast, process continues on server
ssh -o BatchMode=yes user@host \
  "kill -9 OLD_PID 2>/dev/null; sleep 1; \
   cd /path/to/service && \
   nohup .venv/bin/uvicorn amos_api.main:app --host 0.0.0.0 --port 8100 \
   > /tmp/uvicorn.log 2>&1 & \
   echo 'UVICORN_STARTED'"
```

**Key changes:**
- `nohup ... &` — detaches from SSH session
- `> /tmp/uvicorn.log 2>&1` — captures output to file
- `echo 'UVICORN_STARTED'` — SSH exits fast with confirmation
- `-o BatchMode=yes` — non-interactive, fails fast on auth issues

**Why this matters**: A bare `&` in SSH keeps the shell open. `nohup` + redirect + `echo` ensures SSH exits immediately while the process runs on the server.

**For long-running commands**, add a timeout guard:
```bash
timeout 60s ssh -o BatchMode=yes user@host "long-command; echo DONE"
```

**Status:** v0.3.0 | **RFCs:** 18 defined | **Implementation:** Phase 1-6

## Overview

pi-harness-runtime is a local-first, provider-agnostic AI coding harness runtime for pi.dev. It coordinates multiple AI models to complete software engineering tasks with minimal human intervention.

## Core Architecture

```
Human Requirement
  -> /harness start <requirement>
      -> Master Planner (creates task graph)
      -> Loop Runtime (executes tasks)
          -> Provider Router (selects best model)
          -> BlackBoard (coordination)
          -> Checkpoint Manager (resumability)
          -> Quota Manager (avoid exhaustion)
          -> Scheduler (pause/resume)
          -> Repair Engine (auto-fix failures)
      -> /harness status (report)
```

## Commands

### Usage Commands

| Command | Description |
| --------- | ------------- |
| `/usage` | Show full status (local tracking + provider mirror) |
| `/usage refresh` | Force refresh quota from MiniMax console |
| `/usage today` | Today's usage + 5h window |
| `/usage week` | This week's usage + lifetime |
| `/usage reset` | Clear provider mirror |

### Harness Commands

| Command | Description |
| --------- | ------------- |
| `/harness start <requirement>` | Start a new harness job |
| `/harness status` | Show current job status |
| `/harness tasks` | List all tasks |
| `/harness pause` | Pause the current job |
| `/harness resume` | Resume a paused job |
| `/harness cancel` | Cancel the current job |

### Authentication Commands

| Command | Description |
| --------- | ------------- |
| `/harness auth minimax` | Authenticate with MiniMax (opens browser) |
| `/harness auth check` | Check MiniMax auth status |
| `/harness auth scrape` | Scrape MiniMax usage (silent, uses saved profile) |

**First-time setup:**

```bash
harness-auth auth
# -> Opens Chrome browser, login once, profile auto-saves
# Or: bun packages/auth/src/run-minimax-auth.ts auth
```

**Subsequent usage:**

```bash
harness-auth scrape
# -> Silent scraping with saved profile
# Or: bun packages/auth/src/run-minimax-auth.ts scrape
```

## Job State Machine

```
created -> planning -> queued -> running -> testing -> reviewing
    v        v         v        v         v
cancelled  blocked   waiting_human  repairing  ready_for_client
                                        v            v
                                  paused_quota    archived
```

### State Transitions

| From | Valid Transitions |
| ------ | ----------------- |
| created | planning |
| planning | queued, cancelled |
| queued | running, cancelled, waiting_human |
| running | testing, reviewing, repairing, paused_quota, blocked, waiting_human, cancelled |
| testing | reviewing, running, repairing, paused_quota, waiting_human, cancelled |
| reviewing | repairing, running, ready_for_client, paused_quota, waiting_human, cancelled |
| repairing | running, testing, reviewing, paused_quota, waiting_human, cancelled |
| paused_quota | running, waiting_human, cancelled |

## Task Graph

Tasks are organized as a DAG (Directed Acyclic Graph):

- Tasks with dependencies are marked `pending` until all dependencies are `done`
- Tasks without dependencies start as `ready`
- Only `ready` tasks are picked for execution

## Key Components

### JobStateMachine (`harness/job-state-machine.ts`)

- Manages job lifecycle states
- Emits events on every transition
- Auto-checkpoints to disk

### TaskGraphManager (`harness/task-graph.ts`)

- DAG-based task representation
- Tracks task status and dependencies
- Computes topological execution order

### MasterPlanner (`harness/master-planner.ts`)

- Converts requirements to task graphs
- Heuristic planner (no LLM needed)
- LLM-based planner (with provider config)

### RepairEngine (`harness/repair-engine.ts`)

- Converts failures to repair tasks
- Retry policy with exponential backoff
- Auto-escalation after max retries

### SharedBlackboard (`harness/blackboard.ts`)

- File-based agent coordination
- Next-action queue
- Agent registry and locks

### LoopRuntime (`harness/loop-runtime.ts`)

- Core execution loop
- Picks ready tasks, executes, tests, reviews
- Handles failures and quota exhaustion

### ContextWindowManager (`harness/context-window-manager.ts`)

- Tracks context usage per provider
- Warning at 80%, critical at 95%
- Truncation strategy

### AgentHandoffProtocol (`harness/agent-handoff.ts`)

- Clean agent transitions
- Context transfer
- Handoff validation

### E2ETestEngine (`harness/e2e/test-engine.ts`)

- Scenario-based E2E testing
- Screenshot/video on failure
- Playwright runner integration

### ProjectDetector (`harness/project-detector/detector.ts`)

- Auto-detect: Frappe, Next.js, React, Django, Laravel
- Seed strategy recommendation
- E2E strategy recommendation

## Providers

### Provider Adapter (`packages/providers/adapters.ts`)

- MiniMax, OpenAI adapters
- Unified error parsing
- Quota signal extraction

### Quota Manager (`packages/quota-manager/quota-manager.ts`)

- Collects signals from API, Playwright, local estimates
- Tracks 5h, daily, weekly, monthly windows
- Selects best available provider

### Worktree Manager (`packages/worktree/worktree.ts`)

- Git worktree per task
- Isolated workspaces
- Diff tracking

## Usage Example

```typescript
// Start a new job
/harness start Build a REST API with authentication

// Monitor progress
/harness status
/harness tasks

// Pause when quota is low
/harness pause

// Resume when quota resets
/harness resume

// Cancel if needed
/harness cancel
```

## Data Directory

All harness data is stored in `~/.pi/harness/`:

```
~/.pi/harness/
  jobs/
    <job-id>/
      checkpoint.json
      events.jsonl
      task-graph.json
      blackboard/
      repair-tasks.jsonl
      handoffs/
```

## Testing

Run tests with:

```bash
pi-harness-runtime@latest
```

## Related Skills

- `form-state-persistence-fix` — Step data persistence patterns
- `frappe-gl-preview` — GL entry preview pattern
- `frappe-workflow` — Workflow debugging patterns
