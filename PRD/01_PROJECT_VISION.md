# 01_PROJECT_VISION.md

> Project: pi-harness-runtime  
> Version: Draft 0.1  
> Status: Product Vision  
> Date: 2026-06-29

---

## 1. Executive Summary

pi-harness-runtime is a local-first, provider-agnostic AI coding harness runtime for pi.dev.

Its purpose is to let a developer enter a software requirement once, then allow multiple AI coding agents to plan, implement, test, review, repair, pause on quota exhaustion, resume after reset, and continue until the code is ready for human review.

The project begins as a pi.dev extension and can evolve into a larger runtime with external orchestration, observability, and multi-agent interoperability.

---

## 2. Problem Statement

Modern AI coding agents are powerful, but still fragile for long-running real-world work.

Current pain points:

1. **Quota exhaustion stops progress**
   - MiniMax may return usage limit errors without a clear reset time in API responses.
   - GLM may expose reset time in the error response.
   - Codex has `/status`, but other providers vary.

2. **Tasks are not always resumable**
   - If a model stops overnight, the developer must manually inspect logs and restart.
   - Context may be lost.
   - Work may be partially completed but not recorded as durable task state.

3. **Agent workflows are not runtime-managed**
   - Most tools focus on prompts, agents, or chains.
   - Few systems treat AI coding as a durable runtime loop.

4. **Human involvement is too frequent**
   - The desired workflow is not constant human approval.
   - The target is human-on-the-loop: human starts, occasionally checks, and reviews the result.

5. **Provider-specific behavior leaks into the workflow**
   - Each provider has different errors, quota limits, headers, console UI, and model behavior.
   - A robust system needs adapters and routing.

---

## 3. Product Vision

pi-harness-runtime will become a runtime layer for autonomous AI coding.

The system should support this workflow:

```text
1. Human meets client and receives requirement.
2. Human enters requirement into pi.dev TUI.
3. Codex or another planner creates a master plan.
4. Runtime decomposes plan into tasks.
5. Runtime assigns tasks to MiniMax, GLM, Codex, or other providers.
6. Sub-agents write code in isolated git worktrees.
7. Runtime runs tests and reviews diffs.
8. If failures happen, runtime repairs.
9. If quota is exhausted, runtime pauses and resumes later.
10. Runtime continues until code is ready for client review.
11. Human reviews, adjusts, or presents to client.
```

---

## 4. Target User

Primary target user:

- Solo developer or small software studio owner
- Uses pi.dev or similar coding agent
- Works on client software projects
- Wants AI agents to continue coding while the human is away
- Needs quota-aware, resumable, auditable execution

Secondary target users:

- AI coding tool builders
- Agent framework researchers
- Developers who coordinate multiple LLM providers
- Teams that want local-first autonomous coding pipelines

---

## 5. Product Positioning

pi-harness-runtime is not a direct replacement for LangChain, LangGraph, smolagents, AutoGen, or CrewAI.

It is a runtime layer focused on:

- AI coding workflows
- quota-aware execution
- resumability
- provider routing
- git worktree isolation
- local TUI integration
- human-on-the-loop operation

Other frameworks may be integrated later as optional modules.

---

## 6. Core Product Capabilities

### 6.1 Loop Runtime

Runs the repeated execution cycle:

```text
pick task
assign model
code
test
review
repair
pause/resume
finish
```

### 6.2 Provider Adapter System

Normalizes provider-specific behavior:

- model invocation
- error detection
- quota detection
- reset time discovery
- retry policy
- model capability metadata

### 6.3 Quota Manager

Detects and manages provider limits.

Initial provider handling:

- Codex: use `/status` or available status signal
- GLM: parse 429 reset messages
- MiniMax: detect 2056 usage limit and use Playwright console scraping as quota sensor

### 6.4 Checkpoint Manager

Persists task state so the runtime can resume after:

- quota exhaustion
- crash
- reboot
- network failure
- manual pause

### 6.5 Scheduler

Waits until the correct time to resume work.

In prototype:

- local timer
- JSON state

Later:

- systemd timer
- cron
- SQLite-backed queue
- BullMQ or external queue

### 6.6 Git Worktree Manager

Creates isolated workspaces for parallel or recoverable coding tasks.

Goals:

- avoid branch conflicts
- preserve partial work
- allow reviewer agent to inspect diffs
- allow separate models to work on separate tasks

### 6.7 Reviewer Engine

Reviews changes before marking a task complete.

Can use:

- Codex
- GLM
- Claude
- Kimi
- static checks
- tests

### 6.8 TUI Commands

Initial command examples:

```text
/harness run
/harness status
/harness pause
/harness resume
/harness tasks
/harness usage
/harness quota-sync
```

---

## 7. Non-Goals for v0.1

v0.1 does not need:

- full distributed orchestration
- Google A2A
- LangGraph integration
- LangSmith integration
- web dashboard
- multi-user permissions
- SaaS deployment
- perfect provider quota accuracy
- fully automatic browser cookie extraction beyond local Playwright session

The first version should prove the local loop works.

---

## 8. MVP Scope

The MVP should support:

1. One repo
2. One active job
3. Simple task list
4. Local JSON state
5. MiniMax quota detection
6. GLM reset parsing
7. Manual or Playwright MiniMax reset discovery
8. Pause/resume after quota reset
9. Basic test command execution
10. Basic review step
11. pi.dev TUI command integration

---

## 9. Success Metrics

The MVP is successful when:

- A task can be started from pi.dev TUI.
- The runtime persists task state.
- The runtime can detect MiniMax 2056 usage limit.
- The runtime can record a reset time.
- The runtime can pause safely.
- The runtime can resume the same job later.
- The runtime can continue after failure without losing the original requirement.
- The human can inspect a final status report.

---

## 10. Long-Term Roadmap

### v0.1 — Local Runtime Skeleton

- project structure
- PRD/RFC documents
- basic commands
- JSON state
- provider adapter interface

### v0.2 — Quota-Aware Runtime

- MiniMax 2056 detection
- GLM reset parsing
- MiniMax Playwright usage scrape
- scheduler pause/resume

### v0.3 — Coding Loop

- task queue
- run model
- apply code changes
- run tests
- review diff

### v0.4 — Worktree Isolation

- create worktree per task
- merge strategy
- review before merge

### v0.5 — Multi-Provider Router

- fallback provider
- capability tags
- quota-aware provider selection

### v0.6 — Observability

- execution logs
- trace events
- failure timeline
- optional LangSmith exporter

### v1.0 — Production-Ready Local Harness

- stable APIs
- durable storage
- plugin system
- documented extension lifecycle
- real-world client project workflow

---

## 11. Strategic Principle

The runtime should not optimize for impressive demos.

It should optimize for reliable overnight work.

The core promise:

> Give the runtime a requirement.  
> It keeps working, survives interruption, and returns with code ready for review.
