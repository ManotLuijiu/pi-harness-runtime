# 02_GLOSSARY.md

> Project: pi-harness-runtime  
> Version: Draft 0.1  
> Status: Glossary  
> Date: 2026-06-29

---

## Agent

An AI-driven worker that can reason, call tools, write code, review output, or perform a specific task.

In this project, agents are coordinated by the Runtime.

---

## Harness

The full control system around AI agents.

A Harness includes:

- Runtime
- Loop Engine
- Provider Router
- Quota Manager
- Scheduler
- Checkpoint Manager
- Worktree Manager
- Reviewer Engine
- TUI
- Logs and observability

Analogy:

```text
Harness = the whole machine
Loop = the engine inside the machine
```

---

## Harness Engineering

The discipline of designing the full machine that coordinates AI agents, tools, state, providers, retries, tests, and review.

Harness Engineering is broader than prompt engineering.

It asks:

- How does the system continue working?
- How does it recover?
- How does it route work?
- How does it preserve state?
- How does it know when to stop?

---

## Loop

A repeated execution cycle that continues until the job reaches a terminal state.

Canonical loop:

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

## Loop Engineering

The discipline of designing reliable repeated AI execution cycles.

Loop Engineering focuses on:

- task progression
- failure handling
- retries
- repair attempts
- pause/resume
- exit conditions

Loop Engineering lives inside Harness Engineering.

---

## Runtime

The software component that owns execution.

The Runtime decides:

- what runs next
- which model is assigned
- when to checkpoint
- when to pause
- when to resume
- when to escalate
- when to finish

The Runtime is the core of pi-harness-runtime.

---

## Provider

A model vendor or model execution backend.

Examples:

- Codex
- MiniMax
- GLM
- Claude
- Gemini
- OpenRouter
- local model runtime

---

## Provider Adapter

A module that hides provider-specific behavior behind a stable interface.

A Provider Adapter handles:

- calling the model
- parsing provider errors
- detecting quota limits
- extracting reset times when available
- normalizing output

---

## Provider Router

The component that chooses which provider should handle a task.

It may consider:

- task type
- model capability
- quota state
- cost
- speed
- reliability
- previous failures

---

## Quota

A usage limit imposed by a provider.

Quota may be based on:

- tokens
- credits
- requests
- time window
- subscription plan

---

## Quota Manager

The component that tracks provider quota state and decides whether a provider is available.

It may use:

- API response headers
- provider error messages
- provider status endpoints
- local usage logs
- Playwright scraping
- manual mirror data

---

## MiniMax 2056

A MiniMax error code observed when Token Plan usage limit is reached.

Example:

```text
Token Plan usage limit reached:
Upgrade your Token Plan or purchase Credits for more usage.
(2056)
```

For pi-harness-runtime, this is treated as a quota exhaustion signal.

---

## Reset Time

The time when a provider quota window becomes usable again.

Examples:

- GLM may include reset time in its error response.
- Codex may expose status through `/status`.
- MiniMax may require console scraping or local estimation.

---

## Playwright Adapter

A browser automation module used to read provider console information when no official usage API exists.

For MiniMax, this may read:

```text
https://platform.minimax.io/console/usage
```

The Playwright Adapter should not store passwords.

It should use a persistent local browser profile after user login.

---

## Checkpoint

A durable record of runtime progress.

A checkpoint may include:

- job ID
- task ID
- requirement
- current status
- selected provider
- worktree path
- last error
- resume time
- test result
- review result
- next action

---

## Checkpoint Manager

The component that writes, reads, and validates checkpoints.

Its goal is to make long-running jobs restartable.

---

## Scheduler

The component that decides when to run or resume work.

Examples:

- resume after quota reset
- retry after temporary error
- run next task immediately
- wait for human review

---

## Git Worktree

A Git feature that allows multiple working directories from the same repository.

In this project, worktrees are used to isolate AI coding tasks.

Benefits:

- reduce conflicts
- preserve partial work
- allow parallel task execution
- simplify review and merge

---

## Worktree Manager

The component that creates, tracks, and cleans up Git worktrees.

---

## Task

A unit of work derived from a larger requirement.

Example:

```text
Add MiniMax quota detector
```

A task should have:

- ID
- title
- description
- status
- assigned provider
- worktree
- acceptance criteria

---

## Job

A full user-requested objective.

Example:

```text
Build pi-harness-runtime MVP
```

A job contains many tasks.

---

## Task Graph

The dependency structure between tasks.

Example:

```text
Provider Adapter Interface
  -> MiniMax Adapter
  -> Quota Manager
  -> Resume Scheduler
```

---

## Planner

An agent or component that converts a requirement into a plan or task graph.

Codex may act as Master Planner in the intended workflow.

---

## Reviewer

An agent or component that inspects code changes before a task is marked complete.

Reviewer may check:

- diff quality
- TypeScript correctness
- test results
- architecture rules
- project-specific rules

---

## Repair

A loop step that attempts to fix failed tests, review comments, or runtime errors.

---

## Escalation

A controlled handoff to a human when the Runtime cannot safely continue.

Escalation reasons may include:

- unclear requirement
- repeated test failure
- dangerous command
- merge conflict
- unknown provider error
- missing credentials

---

## Human-in-the-Loop

A workflow where the human must frequently approve or guide individual steps.

This is not the primary target of pi-harness-runtime.

---

## Human-on-the-Loop

A workflow where the human defines objectives and reviews outcomes, while the Runtime handles execution autonomously.

This is the primary target of pi-harness-runtime.

---

## Ready for Client

A terminal or near-terminal job state where the Runtime believes the code is prepared for human review before client presentation.

It does not mean the code is automatically deployed or delivered without approval.

---

## TUI

Terminal User Interface.

In this project, pi.dev TUI is the initial command surface.

---

## pi.dev Extension

The initial packaging layer for pi-harness-runtime.

It provides:

- commands
- status display
- local integrations
- access to pi.dev context

The extension should call the Runtime; it should not contain all runtime logic directly.

---

## LangChain

A framework for composing model calls, tools, prompts, and agent workflows.

May be used later, but is not required for the first version.

---

## LangGraph

A state-machine/graph-based framework for durable agent workflows.

May be useful later if pi-harness-runtime outgrows local TypeScript state management.

---

## LangSmith

An observability, tracing, and evaluation platform for LLM applications.

May be used later for runtime traces and debugging.

---

## Google A2A

Agent-to-Agent protocol for communication between separate agents or systems.

Not required for the local MVP, but may become useful if pi-harness-runtime becomes distributed.

---

## Local First

A design principle that the Runtime should work on a developer machine without requiring a cloud service.

---

## Provider Agnostic

A design principle that the Runtime core should not depend on a specific LLM vendor.

---

## Resumable by Design

A design principle that every long-running operation should survive interruption and continue from a checkpoint.
