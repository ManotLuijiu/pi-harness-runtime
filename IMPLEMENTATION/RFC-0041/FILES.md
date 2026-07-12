# Files — RFC-0041

Create `packages/prompt-compiler/src/*` and `packages/prompt-compiler/test/*`.

Modify runtime integration only after package tests pass:

```text
harness/loop-runtime.ts
harness/agent-handoff.ts
```

Do not modify quota, notification, browser, or worktree packages.
