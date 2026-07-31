# TODO: Complete todo-bd-sync Implementation

## Status: Phase 1 & 2 Complete

### What was implemented

1. **Package structure** (`packages/todo-bd-sync/`)
   - ✅ `src/types.ts` - Type definitions for TodoTask, BdIssue, IdMappingRegistry
   - ✅ `src/detector.ts` - Dependency detection (rpiv-todo, bd CLI)
   - ✅ `src/sync.ts` - Two-way sync logic (todo ↔ bd)
   - ✅ `src/index.ts` - Main API with TodoBdSync class
   - ✅ `src/extension.ts` - pi-coding-agent extension entry
   - ✅ `src/todo-reminder.ts` - Auto-reminder for continuing todos
   - ✅ `package.json` - Package manifest

2. **Integration into main extension**
   - ✅ Added import and lazy initialization to `index.ts`

3. **Documentation**
   - ✅ `docs/todo-bd-sync.md` - Full documentation with auto-reminder feature
   - ✅ `README.md` - Added section and commands

---

## New: Auto-Reminder Feature (Phase 2)

### Problem Fixed

- **Bug**: LLM completes tasks but stays silent about remaining todos
- **User had to manually ask**: "continue with todos" or "wrap up"

### Solution

The `todo-reminder.ts` module injects reminders when todos remain:

**Prerequisite**: Tasks must be created with `bd create` (not via `/todo` command).

```typescript
// After agent completes a task:
// Checks bd for remaining todos
// Injects message:
"Remaining todos detected:
[bd-a1b2] Review PR (pending)

Please continue with the next pending task or ask the user which to prioritize."
```

### How It Works

1. Hooks into `agent_end` and `tool_execution_end`
2. Calls `bd ready --json` to check remaining todos
3. If pending tasks exist, sends reminder via `pi.sendUserMessage()`
4. 5-second cooldown to prevent spam

---

## Remaining Tasks

### P1: Test Basic Integration

```bash
# Restart pi and test
pi

# Check if todo-bd-sync is enabled
/bd-todo-status
```

### P2: Test Auto-Reminder

1. Create a multi-step task via bd:

   ```bash
   bd create "Build API" -p 2
   bd create "Add tests" --parent <parent-id>
   bd create "Deploy" --parent <parent-id>
   ```

2. Ask LLM to work on it:

   ```
   Build the API and manage tasks with bd
   ```

3. After completing a task, verify reminder is injected:
   - Should see message about remaining todos
   - LLM should offer to continue

### P3: Tune Reminder Behavior

- Adjust cooldown (currently 5 seconds)
- Customize reminder message template
- Test with various task counts

---

## Files Summary

| File | Purpose |
|------|---------|
| `src/types.ts` | Type definitions |
| `src/detector.ts` | Check dependencies |
| `src/sync.ts` | bd CLI integration |
| `src/todo-reminder.ts` | **NEW: Auto-reminder injection** |
| `src/index.ts` | Main API |
| `src/extension.ts` | Extension entry |

---

## Testing Plan

1. **Basic sync**: Create bd issue → verify sync
2. **Auto-reminder**: Multi-step task → verify reminder appears
3. **Integration**: Full workflow test

---

## Notes

- The implementation uses lazy imports to avoid breaking if dependencies are missing
- bd CLI must be installed for full functionality
- rpiv-todo is optional (fallback mode available)
- Auto-reminder does NOT modify the overlay (it works fine)
- Only injects context to prompt LLM to continue
