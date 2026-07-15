# RFC-0071 — Requirement Intake

## Summary

Captures and structures requirements from natural language, GitHub issues, or structured input into typed `Requirement` objects ready for downstream planning systems.

## Motivation

Agents need a consistent way to convert informal requests into structured requirements with priority, effort estimates, and dependency metadata — without requiring a human to fill out a template.

## Architecture

```
User Input (text, GitHub issue, PR description)
        ↓
┌─────────────────────┐
│  RequirementParser  │  → Extracts title, description, tags, priority
└─────────────────────┘
        ↓
┌─────────────────────┐
│ RequirementClassifier│  → Labels type: feature, bug, chore, spike
└─────────────────────┘
        ↓
┌─────────────────────┐
│ EffortEstimator     │  → Tags effort: XS, S, M, L, XL (story points)
└─────────────────────┘
        ↓
    Requirement[]
```

## Types

```ts
export type RequirementType = "feature" | "bug" | "chore" | "spike" | "research";
export type EffortLevel = "XS" | "S" | "M" | "L" | "XL";
export type Priority = "critical" | "high" | "medium" | "low";

export interface Requirement {
  id: string;
  type: RequirementType;
  title: string;
  description: string;
  priority: Priority;
  effort: EffortLevel;
  tags: string[];
  dependencies: string[];       // IDs of blocking requirements
  acceptanceCriteria: string[];
  source?: string;             // e.g. "GitHub Issue #42"
  raw?: string;                // Original input
}

export interface RequirementIntakeOptions {
  strict?: boolean;            // Reject ambiguous input vs. guess
  defaultPriority?: Priority;
  maxDescriptionLength?: number;
}
```

## Core Functions

### `parse(text, options?)`
Parses raw text into a `Requirement`. Uses keyword detection for type and priority cues.

### `parseBatch(texts, options?)`
Processes multiple inputs in parallel.

### `classify(requirement)`
Infers `RequirementType` from content analysis.

### `estimateEffort(requirement)`
Tags effort level based on description complexity heuristics.

### `addDependency(requirement, dependsOnId)`
Adds a dependency relationship. Validates no cycles.

## Events

| Event | Payload |
|-------|---------|
| `requirement.parsed` | `{ requirement }` |
| `requirement.classified` | `{ requirement }` |
| `requirement.classification.conflict` | `{ requirement, suggested }` |

## Dependencies

- `@pi-harness/capability-registry` — for capability-based requirements
- `@pi-harness/memory-engine` — for context from previous sessions

## Acceptance Criteria

- [ ] Parses natural language into typed Requirement
- [ ] Keyword detection for type and priority
- [ ] Batch parsing for issue triage
- [ ] Cycle detection in dependencies
- [ ] Unit tests with >80% coverage
