# RFC-0107 — Todo BD Sync

## Purpose

Two-way sync between rpiv-todo tasks and bd (beads) issues.

## Motivation

The pi-coding-agent has a built-in `todo` tool, but it:

- Only tracks tasks locally in session memory
- Is lost when session ends
- Doesn't integrate with git-based issue tracking

**Solution:** Sync todo tool calls to `bd` (beads) so issues persist across sessions and are version-controlled in `.beads/issues.jsonl`.

## Architecture

```text
pi-coding-agent
    |
    ├── todo tool call (create/update/delete)
    |
    ▼
todo-bd-sync extension
    |
    ├── detect todo tool calls
    ├── parse todo → bd format
    ├── sync to .beads/issues.jsonl
    |
    ▼
bd (beads) CLI
    |
    ├── bd sync (git push to remote)
    └── bd issues available in next session
```

## Key Components

### `packages/todo-bd-sync/`

- `detector.ts` — Detect if `bd` is installed
- `sync.ts` — Sync logic (todo ↔ bd)
- `task-analyzer.ts` — Smart todo creation (complexity-based)
- `extension.ts` — pi-coding-agent extension registration

### Extension Points

- **Input transform:** Inject "add tasks to todo-list" for complex work
- **Tool result handler:** Capture todo calls and sync to bd
- **Session end:** Push pending changes via `bd sync`

## Smart Todo Creation

```typescript
// task-analyzer.ts
interface TaskComplexity {
  estimatedSteps: number;  // < 3 = simple, 3-7 = medium, > 7 = complex
  hasBlockers: boolean;
  isMultiSession: boolean;
}

// For complex tasks, agent creates bd issues instead of inline todos
if (complexity.estimatedSteps > 5 || complexity.isMultiSession) {
  // Prompt: "This looks complex. Create bd issues for tracking?"
}
```

## Integration with Other RFCs

- **RFC-0103 (Event Bus):** Use event bus for cross-tab sync
- **RFC-0003 (Quota Manager):** Track quota usage per task

## Dependencies

- `bd` CLI installed (`https://github.com/beads/bd`)
- `.beads/` directory in project root

## Files

See `IMPLEMENTATION/RFC-0107/FILES.md`.

## Acceptance Criteria

- [ ] Agent detects bd installation on startup
- [ ] Todo tool calls are synced to `.beads/issues.jsonl`
- [ ] `bd sync` pushes issues to git remote
- [ ] Complex tasks trigger "create bd issue" suggestion
- [ ] No noisy output when bd not installed (silent fallback)
- [ ] Session end triggers final sync
