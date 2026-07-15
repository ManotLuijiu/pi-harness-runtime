# RFC-0075 — Milestone Manager

## Summary

Tracks milestones (releases, phases, deadlines) against sprint progress and alerts when items are at risk.

## Motivation

Agents and humans need to know if a milestone is on track, at risk, or missed — based on sprint velocity and remaining work.

## Types

```ts
export type MilestoneStatus = "on-track" | "at-risk" | "missed" | "completed";

export interface Milestone {
  id: string;
  title: string;
  targetDate: string;
  description?: string;
  linkedRequirementIds: string[];
  status: MilestoneStatus;
  completion: number;      // 0-100
  blockers: string[];
}

export interface MilestoneHealth {
  milestone: Milestone;
  onTrackItems: number;
  totalItems: number;
  daysRemaining: number;
  dailyCapacityNeeded: number;
  riskLevel: "low" | "medium" | "high";
  message: string;
}
```

## Core Functions

### `createMilestone(data)`
Creates a new milestone linked to requirements.

### `assessHealth(milestone, sprintVelocity)`
Calculates health score and risk level.

### `checkMilestones(milestones, velocity)`
Batch assessment of all milestones.

### `alertMilestoneRisk(health)`
Generates alert text for at-risk milestones.

## Acceptance Criteria

- [ ] Creates and tracks milestones
- [ ] Calculates completion percentage
- [ ] Risk assessment based on velocity
- [ ] Alert messages for at-risk milestones
- [ ] Unit tests
