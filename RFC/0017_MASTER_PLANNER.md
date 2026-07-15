# RFC-0017 — Master Planner

## Status
Proposed

## Motivation

Convert a natural-language requirement into an executable TaskGraph, then publish it to the Shared Blackboard for the Scheduler to pick up.

## Pipeline

1. **Requirement Intake** — Parse raw text, extract functional requirements, acceptance criteria
2. **Decomposition** — Break into implementation tasks using LLM + learned patterns
3. **Dependency Analysis** — Identify cross-task dependencies, build edges
4. **Estimation** — Assign story points, deadlines
5. **Graph Publish** — Write TaskGraph to Shared Blackboard, notify Scheduler

## Output

```ts
interface PlannerOutput {
  requirementId: string;
  graph: TaskGraph;
  estimates: Map<TaskId, StoryPoints>;
  blockers: string[]; // requirements that can't be decomposed
  publishedAt: number;
}
```

## Package

`packages/master-planner/`
