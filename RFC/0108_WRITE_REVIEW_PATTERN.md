# RFC-0108 — Write Review Pattern

## Purpose

Two-agent code writing with autonomous review loop.

## Motivation

Single-agent coding misses edge cases and produces lower-quality code. A two-agent pattern:

- **Writer Agent:** Generates code
- **Reviewer Agent:** Evaluates and requests fixes
- Loop until acceptable or max iterations

## Architecture

```
User Request
    │
    ▼
Writer Agent
    │
    ├── Generate code
    │
    ▼
Blackboard (shared state)
    │
    ├── Write code artifact
    ├── Write review feedback
    │
    ▼
Reviewer Agent
    │
    ├── Read blackboard
    ├── Evaluate code quality
    ├── If FAIL → write feedback → loop
    └── If PASS → deliver result
```

## Key Components

### `packages/write-review/`

- `blackboard.ts` — Shared state between writer/reviewer
- `trigger.ts` — Detect when to activate review pattern
- `injection.ts` — System prompt injection for agents
- `gate.ts` — Reviewer verdict (pass/fail/fix)
- `review.ts` — Review criteria engine

### Blackboard Schema

```typescript
interface Blackboard {
  artifacts: {
    code: string;
    language: string;
    filePath?: string;
  }[];
  review: {
    verdict: "pass" | "fail" | "fix_requested";
    findings: Finding[];
    iteration: number;
  };
  metadata: {
    created: string;
    updated: string;
    author: string;
  };
}
```

### Trigger Detection

Review pattern activates when:

- File matches trigger patterns (e.g., `*.test.ts`)
- Task description contains review keywords
- Explicit `/review` command

## Review Criteria

```typescript
const REVIEW_CRITERIA = [
  "correctness",      // Does it solve the problem?
  "type_safety",     // TypeScript types correct?
  "edge_cases",      // Handles null/undefined/empty?
  "security",        // No injection vulnerabilities?
  "performance",     // No obvious O(n²) loops?
  "testability",     // Can be unit tested?
];
```

## Integration with Other RFCs

- **RFC-0101 (Autonomous Operations):** Use autonomous runtime for agent execution
- **RFC-0057 (Evaluation Engine):** Leverage evaluation engine for pass/fail

## Dependencies

- `packages/autonomous-runtime/` for agent execution
- `packages/evaluation-engine/` for criteria evaluation

## Files

```
packages/
  write-review/
    src/
      index.ts           # Main exports
      blackboard.ts     # Shared state
      trigger.ts        # Activation detection
      injection.ts      # Prompt injection
      gate.ts           # Verdict handling
      review.ts         # Review engine
      types.ts          # Shared types
```

## Acceptance Criteria

- [ ] Writer generates code to blackboard
- [ ] Reviewer reads and evaluates code
- [ ] Failed reviews trigger fix loop
- [ ] Max iterations prevent infinite loops
- [ ] Pass verdicts deliver to user
- [ ] Trigger detection works for test files
