# 00_PROJECT_RULES.md

> Project: pi-harness-runtime  
> Version: Draft 0.1  
> Status: Living Document  
> Date: 2026-06-29

---

## 1. Purpose

This document defines the architectural principles of **pi-harness-runtime**.

Every feature, module, provider, scheduler, runtime component, and future pull request should follow these principles.

When two implementation approaches conflict, this document takes precedence over short-term convenience.

---

## 2. Vision

pi-harness-runtime is an autonomous AI Harness Runtime that coordinates multiple AI models, developer tools, and execution environments to complete software engineering tasks with minimal human intervention.

The runtime is designed to survive:

- model failures
- provider quota exhaustion
- network interruptions
- machine restarts
- test failures
- long-running project execution

without losing progress.

---

## 3. Core Philosophy

pi-harness-runtime is **not another AI agent**.

It is the runtime that coordinates AI agents.

Just as an operating system schedules processes rather than becoming the application itself, pi-harness-runtime schedules, monitors, retries, checkpoints, and resumes AI coding agents.

---

## 4. Principle 1 — Runtime First

Business logic must not live inside provider adapters.

The Runtime owns:

- scheduling
- checkpoints
- task execution
- state transitions
- retries
- orchestration
- failure handling

Provider adapters only execute provider-specific requests.

Good:

```text
Runtime
  -> Provider Adapter
      -> MiniMax
```

Bad:

```text
MiniMax Adapter
  -> Task Scheduler
  -> Checkpoint Engine
  -> Loop Runtime
```

---

## 5. Principle 2 — Provider Agnostic

No feature may depend on one LLM vendor.

Supported providers should be interchangeable:

- Codex
- MiniMax
- GLM
- Claude
- Gemini
- OpenRouter
- Local models

Adding a provider should require implementing only a Provider Adapter, not rewriting the Runtime.

---

## 6. Principle 3 — Everything Is Resumable

Every long-running task must be restartable.

The Runtime must never assume:

- uninterrupted internet
- unlimited quota
- continuous execution
- error-free models
- a single process that never crashes

Every important state change must be checkpointed.

---

## 7. Principle 4 — Human-on-the-Loop

Humans define objectives.

Humans review important milestones.

Humans approve delivery.

Humans should not manually drive every execution step.

The Runtime should maximize autonomous execution while preserving clear intervention points for human oversight.

This project targets:

```text
Human starts the job
AI works through the loop
Human checks final or occasional milestone
```

not:

```text
Human approves every tiny step
```

---

## 8. Principle 5 — Loops Own Execution

Execution is performed by the Loop Runtime.

Harness Runtime coordinates loops.

Providers do not own loops.

The canonical loop is:

```text
while not ready_for_client:
    pick next task
    assign model
    code
    run tests
    review diff
    if failed:
        repair
    if quota_limit:
        pause and resume later
    if blocked:
        escalate to human
```

---

## 9. Principle 6 — Failures Are Expected

Failures are normal runtime events.

The Runtime must expect:

- provider quota limits
- API failures
- tool failures
- Git conflicts
- test failures
- browser crashes
- malformed model output
- incomplete code changes

Failures should produce state transitions, not unmanaged termination.

---

## 10. Principle 7 — State Is Durable

All Runtime state must be recoverable.

Possible storage layers:

- JSON files for prototype
- SQLite for local durable runtime
- PostgreSQL for distributed runtime

No important execution state should exist only in memory.

---

## 11. Principle 8 — Small Components

Large components should be split into specialized modules.

Example module boundaries:

- Loop Runtime
- Provider Router
- Provider Adapter
- Quota Manager
- Checkpoint Manager
- Scheduler
- Git Worktree Manager
- Reviewer Engine
- TUI Adapter

Each component should have one responsibility.

---

## 12. Principle 9 — Observable Runtime

Every important runtime decision should be traceable.

Examples:

- Why was MiniMax selected?
- Why did GLM replace MiniMax?
- Why did the runtime pause?
- Which checkpoint resumed?
- Which test failed?
- Which model produced the final diff?

The Runtime should be debuggable after long autonomous execution.

---

## 13. Principle 10 — Local First

The Runtime should work without cloud orchestration.

External systems such as LangGraph, LangSmith, Google A2A, and hosted queues must be optional enhancements.

Core Runtime functionality should remain available locally.

---

## 14. Principle 11 — Extensible Architecture

Every major subsystem should support extension.

Examples:

```text
providers/
scheduler/
reviewers/
quota/
automation/
storage/
```

A new provider, quota strategy, or scheduler should be addable without modifying the runtime core.

---

## 15. Principle 12 — AI Is Replaceable

Models evolve.

The Runtime should outlive today's frontier models.

No architecture decision should assume that any current model or provider is permanent.

Only the Provider Adapter layer should know vendor-specific APIs and failure formats.

---

## 16. Long-Term Goal

```text
Client Requirement
  -> pi.dev TUI
      -> Harness Runtime
          -> Loop Runtime
              -> Planner
              -> Provider Router
              -> Sub-agents
              -> Git Worktrees
              -> Checkpoint Manager
              -> Quota Manager
              -> Scheduler
              -> Reviewer
              -> Testing
              -> Repair
              -> Client Ready
```

The Runtime continues operating until software is ready for client review or reaches a clear escalation point.

---

## 17. Project Motto

> Humans define goals.  
> The Runtime finishes the work.

---

## 18. Governance

This document is intentionally stable.

Future architectural decisions should refine this document rather than contradict it.

If an RFC conflicts with this document, either the RFC must be revised or this document must be explicitly amended.
