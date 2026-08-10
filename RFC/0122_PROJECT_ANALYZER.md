# RFC-0122 — Project Analyzer

## Purpose

Analyze project structure and provide insights.

## Motivation

Understand projects for better assistance:

- Project type detection
- Technology stack identification
- Complexity assessment
- Risk identification

## Analysis Output

```typescript
interface ProjectAnalysis {
  type: "monorepo" | "polyrepo";
  frameworks: string[];
  complexity: "simple" | "medium" | "complex";
  risks: string[];
  recommendations: string[];
}
```

## Files

See `IMPLEMENTATION/RFC-0122/FILES.md`.

## Acceptance Criteria

- [ ] Detect project type
- [ ] Identify technology stack
- [ ] Assess complexity
- [ ] Generate recommendations
