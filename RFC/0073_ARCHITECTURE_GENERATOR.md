# RFC-0073 — Architecture Generator

## Summary

Generates architecture documentation (Mermaid diagrams, README sections, decision records) from a project analysis and a set of architectural decisions.

## Motivation

Agents need to produce readable, visual architecture docs without manual effort. The generator reads a project structure and outputs ASCII/Mermaid diagrams and ADR (Architecture Decision Records).

## Types

```ts
export type DiagramType = "component" | "flow" | "sequence" | "er" | "class";

export interface ArchitectureDiagram {
  type: DiagramType;
  title: string;
  mermaid: string;
  description?: string;
}

export interface ArchitectureSection {
  title: string;
  level: 1 | 2 | 3;
  content: string;
  diagrams: ArchitectureDiagram[];
}

export interface DecisionRecord {
  id: string;
  date: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  title: string;
  context: string;
  decision: string;
  consequences: string;
  alternatives: string[];
  supersedes?: string;
}

export interface ArchitectureOutput {
  readme: ArchitectureSection[];
  diagrams: ArchitectureDiagram[];
  decisions: DecisionRecord[];
}
```

## Core Functions

### `generateFromAnalysis(analysis, options?)`
Takes a `ProjectAnalysis` from `@pi-harness/framework-detector` and produces architecture output.

### `generateDiagram(type, data)`
Creates a Mermaid diagram string from structured data.

### `generateADR(decision, context)`
Creates an Architecture Decision Record.

### `generateReadmeSection(analysis, level)`
Generates an architecture README section.

## Mermaid Templates

```
component: Component architecture (apps, modules, layers)
flow:      Request/response flow
sequence:  API sequence diagrams
er:        Entity-relationship (database schema)
class:     Type/class relationships
```

## Dependencies

- `@pi-harness/framework-detector` — for project analysis
- `@pi-harness/memory-engine` — for existing ADRs

## Acceptance Criteria

- [ ] Generates Mermaid component diagrams from project structure
- [ ] Generates flow diagrams from API routes
- [ ] Produces ADR format from decisions
- [ ] README sections at configurable heading levels
- [ ] Mermaid syntax validation
- [ ] Unit tests
