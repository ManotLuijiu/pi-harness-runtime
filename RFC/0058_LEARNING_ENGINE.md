# RFC-0058 — Learning Engine

## 1. Purpose

The Learning Engine extracts reusable lessons from completed and failed jobs. Its output improves future planning, routing, prompt compilation, repair selection, and evaluation.

The engine learns recommendations, not autonomous policy. Human-approved project rules remain authoritative.

## 2. Inputs

```ts
export interface LearningRequest {
  jobId: string;
  events: RuntimeEvent[];
  evaluation: EvaluationResult[];
  repairHistory: RepairAttempt[];
  providerMetrics: ProviderExecutionMetric[];
  humanFeedback?: HumanFeedback[];
}
```

## 3. Outputs

```ts
export interface LearnedExperience {
  id: string;
  scope: "global" | "framework" | "repository" | "task_type";
  pattern: string;
  recommendation: string;
  confidence: number;
  evidenceRefs: string[];
  status: "proposed" | "approved" | "rejected";
}
```

## 4. Learnable Patterns

- Provider success by task type.
- Prompt structures associated with fewer retries.
- Common failure causes.
- Effective repair strategies.
- Framework-specific command patterns.
- Test scenarios that catch recurring regressions.
- Context sources frequently used in successful jobs.

## 5. Non-Learnable Data

The engine must not learn from or retain:

- Credentials
- Browser cookies
- Personal data not required for engineering
- Secret environment values
- Unreviewed destructive commands

## 6. Confidence

Confidence increases with:

- Repeated independent occurrences
- Consistent positive evaluation
- Human approval
- Framework-specific corroboration

Confidence decreases with:

- Contradictory outcomes
- Single-event evidence
- Stale repository revisions
- Changed project rules

## 7. Approval Flow

```text
experience extracted
 -> proposed
 -> human or policy review
 -> approved
      or rejected
```

Only approved experience may affect routing or planning automatically.

## 8. OKF Integration

Approved lessons may be exported as OKF concepts:

```yaml
---
type: Engineering Lesson
title: Prefer isolated worktrees for parallel file changes
tags: [git, worktree, concurrency]
timestamp: 2026-07-13T00:00:00+07:00
authority: approved
---
```

## 9. Tests

- Extracts repeated failure pattern.
- Does not approve experience automatically.
- Redacts secret-like values.
- Low evidence produces low confidence.
- Human approval raises status to approved.
- Approved lesson exports to OKF.

## 10. Acceptance Criteria

- Every learned item has evidence references.
- Automatic learning cannot override project rules.
- Secrets are excluded.
- Only approved lessons affect runtime behavior.
- Lessons can be exported to OKF.
