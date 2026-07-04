# RFC 0010 - Context Window Manager

## Purpose
Prevent model context overflow by extracting durable runtime state before the context window becomes full.

## Core Rule
Chat history is temporary. Runtime context is durable.

## Motivation
Long-running coding sessions eventually hit context pressure. When context is full, agents forget decisions, repeat work, or require the human to type `resume`.

## Goals
- Estimate context pressure per provider/model.
- Trigger compaction before overflow.
- Extract decisions, task state, open questions, errors, and next action.
- Write `resume_prompt.md`.
- Allow a new agent session to continue without human context routing.

## Trigger Policy
Recommended defaults:

```text
warning_threshold = 0.60
compact_threshold = 0.70
hard_stop_threshold = 0.85
```

## Artifact Layout
```text
harness/context/
  current_state.md
  compact_summary.md
  decisions.md
  open_questions.md
  task_progress.json
  resume_prompt.md
  last_agent_report.md
```

## Runtime Events
- ContextWarning
- ContextCompactionStarted
- ContextCompactionCompleted
- ResumePromptGenerated
- ContextHardStop

## Acceptance Criteria
- Runtime can detect context pressure.
- Runtime can write compact summary and resume prompt.
- New agent can continue from durable files.
