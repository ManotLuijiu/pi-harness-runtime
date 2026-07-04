# RFC 0011 - Shared Blackboard

## Purpose
Define durable file-based coordination so GPT/Codex, MiniMax, GLM, reviewers, and test agents communicate without the human acting as message bus.

## Core Concept
Agents communicate through runtime-owned files, not direct chat and not manual human copy/paste.

## Blackboard Layout
```text
harness/blackboard/
  status.json
  next_action.json
  tasks.json
  agent_registry.json
  locks/
  reports/
  context/
  events.jsonl
```

## Key Rules
1. Agents read `next_action.json` before starting.
2. Agents write to expected output files.
3. Agents never overwrite another agent's report.
4. Runtime owns status transitions.
5. Significant writes append to `events.jsonl`.

## Required Events
- BlackboardInitialized
- TaskReady
- AgentStarted
- AgentReportWritten
- NextActionUpdated
- TaskCompleted
- TaskBlocked

## Acceptance Criteria
- Planner can write a plan.
- Coder can discover ready task.
- Reviewer can discover review task.
- Runtime can detect completion without human routing.
