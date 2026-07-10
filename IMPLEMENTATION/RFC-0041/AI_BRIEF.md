# AI Brief — RFC-0041 Prompt Compiler

Implement a deterministic prompt compiler. Start with pure functions and inject filesystem, clock, hashing, token estimation, policy, and redaction dependencies.

Required source files:

```text
packages/prompt-compiler/src/
├── types.ts
├── normalize.ts
├── section-builder.ts
├── deduplicate.ts
├── budget.ts
├── validate.ts
├── render.ts
├── compiler.ts
└── index.ts
```

Hard requirements:

- No provider network calls.
- No secret persistence.
- Same semantic input must produce the same content hash.
- Project rules and acceptance criteria cannot be compacted away.
- Output-limit continuation must avoid repeating completed work.
