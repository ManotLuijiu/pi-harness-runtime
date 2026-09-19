# todo-bd-sync

Two-way sync between **rpiv-todo** (local task overlay) and **bd** (GitHub issue tracker).

## Terminology Clarification (CRITICAL)

This project uses **TWO** separate task tracking systems:

| Term | Tool | Purpose |
|------|------|---------|
| **bd** / **beads** / **issues** | `bd create`, `bd list`, `bd close` | GitHub issue tracker |
| **todo** / **todos** | `todo` tool (JSON-RPC) | Local task overlay |

### When to use each:

- **bd (beads)**: 
  - Long-lived tasks that persist across sessions
  - GitHub-synced issues
  - Bug tracking, feature requests
  - Tasks that need team visibility

- **todo (local)**:
  - Short-lived session tasks
  - Immediate action items
  - Step-by-step workflows
  - Tasks that don't need to leave the session

### Confusion Prevention

**Agents often confuse these two systems.** To prevent this:

1. **System prompts** (in `index.ts`) include a terminology clarification hint
2. **Slash commands** are registered for status checks:
   - `/bd-todo-status` - Show sync status
   - `/bd-todo-sync` - Manual sync trigger

3. **Always ask the user** when ambiguous:
   > "Did you mean **bd** (issue tracker) or **todo** (local task list)?"

## Usage

```typescript
import { createTodoBdSync } from "@moocoding/todo-bd-sync";

const sync = createTodoBdSync(pi, {
  autoInjectPrompt: true,
  syncDirection: "both",
  loadOnSessionStart: true,
});

sync.start();
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `autoInjectPrompt` | `true` | Inject clarification to system prompt |
| `syncDirection` | `"both"` | Sync direction: both, todoOnly, bdOnly |
| `loadOnSessionStart` | `true` | Load existing bd issues on session start |
| `debug` | `false` | Enable debug logging |

## Commands

- `/bd-todo-status` - Check dependencies and mapping count
- `/bd-todo-sync` - Manually trigger sync

## Dependencies

- `bd` CLI - Must be installed for full functionality
- `rpiv-todo` - Optional (falls back gracefully if not installed)
