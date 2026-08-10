# RFC-0121 — Context Discovery

## Purpose

Discover and index project context for smarter agent assistance.

## Motivation

Agents work better with project context:

- Code structure awareness
- Dependency graph
- API boundaries
- Test coverage

## Discovery Sources

```typescript
const SOURCES = [
  "package.json",      // Dependencies, scripts
  "tsconfig.json",    // TypeScript config
  "*.test.ts",        // Test files
  "README.md",        // Documentation
  "docs/",            // Additional docs
];
```

## Files

See `IMPLEMENTATION/RFC-0121/FILES.md`.

## Acceptance Criteria

- [ ] Index package.json dependencies
- [ ] Discover test files
- [ ] Build dependency graph
- [ ] Cache discovery results
