# RFC-0116 — Code Review Package

## Purpose

Automated code review engine for pull requests and commits.

## Motivation

Review code without human intervention:

- Detect bugs and security issues
- Enforce coding standards
- Provide actionable feedback

## Architecture

```text
Code Change -> Review Engine -> Findings
                  |
                  +-> AST Analysis
                  +-> Pattern Matching
                  +-> Policy Evaluation
```

## Review Criteria

```typescript
const REVIEW_CRITERIA = [
  "correctness",     // Logic errors
  "type_safety",    // TypeScript correctness
  "security",       // Vulnerability detection
  "performance",    // Optimization opportunities
  "style",          // Coding standards
];
```

## Files

See `IMPLEMENTATION/RFC-0116/FILES.md`.

## Acceptance Criteria

- [ ] Detects logic errors in code
- [ ] Finds security vulnerabilities
- [ ] Enforces coding standards
- [ ] Integrates with git workflow
