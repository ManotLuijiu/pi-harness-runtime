# RFC 0012 - Agent Handoff Protocol

## Purpose
Define how one agent's completed work becomes another agent's input without human intervention.

## Handoff States
```text
draft -> ready -> accepted -> running -> completed
draft -> ready -> accepted -> running -> failed
draft -> ready -> blocked
```

## Agent Roles
- master_planner
- code_writer
- bug_fixer
- reviewer
- test_runner
- e2e_runner
- summarizer
- quota_observer

## Handoff Record
```json
{
  "handoff_id": "handoff_001",
  "from_agent": "codex-planner",
  "to_agent": "minimax-coder",
  "task_id": "task_002",
  "status": "ready",
  "input_files": ["harness/blackboard/reports/task_001_plan.md"],
  "expected_output": "harness/blackboard/reports/task_002_implementation.md",
  "acceptance_criteria": ["Implementation follows plan", "Tests pass"]
}
```

## Acceptance Criteria
- Planner can hand off to coder.
- Coder can hand off to reviewer.
- Reviewer can hand off to repair agent.
- Runtime can detect completion from handoff output.
