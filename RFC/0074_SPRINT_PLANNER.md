# RFC-0074 — Sprint Planner

## Summary

Organizes requirements into sprints using velocity-based estimation, capacity planning, and dependency ordering.

## Motivation

Agents need to plan sprints from a backlog — assigning items to sprints based on story points, team capacity, and dependencies.

## Types

```ts
export interface Sprint {
  id: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  capacity: number;        // Total story points
  items: SprintItem[];
  status: "planning" | "active" | "completed";
}

export interface SprintItem {
  requirementId: string;
  title: string;
  storyPoints: number;
  assignee?: string;
  status: "todo" | "in-progress" | "done";
}

export interface SprintPlanOptions {
  sprintDurationDays: number;
  velocity: number;           // Historical avg story points per sprint
  startDate: string;
  minSprintItems?: number;
}
```

## Core Functions

### `planSprints(requirements, options)`
Distributes requirements across sprints. Respects dependencies.

### `calculateVelocity(history)`
Computes average velocity from past sprint data.

### `balanceSprint(sprint, options)`
Rebalances items in a sprint to fit capacity.

### `estimateCompletion(requirements, velocity)`
Predicts how many sprints needed to complete all items.

## Acceptance Criteria

- [ ] Distributes items across sprints respecting capacity
- [ ] Respects dependency ordering (blocked items come later)
- [ ] Velocity-based estimation
- [ ] Sprint date range calculation
- [ ] Unit tests
