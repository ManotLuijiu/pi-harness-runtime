# RFC-0016 — Task Graph

## Status
Proposed

## Motivation

Complex work must be represented as a Directed Acyclic Graph (DAG) so tasks execute only when all dependencies are satisfied.

## Core Concept

A **TaskGraph** contains **nodes** (tasks) and **edges** (dependencies). A task's status is:

- `PENDING` — not yet ready (dependencies not DONE)
- `READY` — all dependencies DONE
- `RUNNING` — currently executing
- `DONE` — completed successfully
- `FAILED` — failed (may trigger repair)
- `SKIPPED` — explicitly skipped

A task becomes `READY` only when all tasks it depends on reach `DONE`.

## Graph Validation

- No cycles allowed (validated on graph build)
- Leaf tasks (no dependents) trigger graph completion
- Critical path identification for progress estimation

## Package

`packages/task-graph/`
