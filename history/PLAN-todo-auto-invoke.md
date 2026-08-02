# Plan: Auto-Invoke Todo Extension

## Current Behavior

The `rpiv-todo` extension only activates when:
1. LLM decides to use `todo` tool based on `promptSnippet` + `promptGuidelines`
2. User explicitly types `/todos`

**Problem**: Users must say "todo" or "task list" for the LLM to use the tool.

## Desired Behavior

**Always** show the todo overlay and prompt the LLM to capture tasks, even without explicit trigger.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        rpiv-todo                                 │
├─────────────────────────────────────────────────────────────────┤
│  index.ts (extension entry)                                      │
│    ├── registerTodoTool() → LLM-callable tool                  │
│    ├── registerTodosCommand() → /todos slash command           │
│    └── Lifecycle handlers: session_start, tool_execution_end   │
├─────────────────────────────────────────────────────────────────┤
│  state/                                                          │
│    ├── store.ts → In-memory state per-session (Map by sid)     │
│    ├── state-reducer.ts → Pure reducer (applyTaskMutation)     │
│    └── replay.ts → Reconstruct from conversation branch         │
├─────────────────────────────────────────────────────────────────┤
│  todo-overlay.ts → Persistent TUI widget above editor           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Insight

The tool is triggered by **LLM decision**, not by event hooks. The `promptSnippet` in `registerTodoTool()` is just a hint to the LLM.

## Solution Approaches

### Option A: System Prompt Injection (Recommended)

**How it works:**
1. Hook into `before_agent_start` event
2. Append instruction to system prompt: "Always use todo tool at session start to capture requirements"

**Pros:**
- Clean separation - doesn't modify rpiv-todo internals
- Works with future rpiv-todo updates
- No duplicate state management

**Cons:**
- Prompt injection adds token overhead
- Depends on LLM actually following the instruction

**Implementation:**
```typescript
// In harness extension
pi.on("before_agent_start", async (event) => {
  event.systemPrompt += "\n\nAlways use the todo tool at the START of every session to capture user requirements before beginning work.";
});
```

### Option B: Input Transformation

**How it works:**
1. Hook into `input` event
2. Append trigger keyword to user input when first message

**Pros:**
- Guaranteed trigger on first user message

**Cons:**
- Pollutes user input with hidden instruction
- More invasive

**Implementation:**
```typescript
// In harness extension
let isFirstInput = true;
pi.on("input", async (event) => {
  if (isFirstInput && event.source === "interactive") {
    event.text += " [AUTO: Use todo tool to capture requirements first]";
    isFirstInput = false;
  }
});
```

### Option C: Direct Tool Call via Registered Tool Executor

**How it works:**
1. In `agent_start`, directly invoke the todo tool's execute function
2. Bypass LLM decision entirely

**Pros:**
- Guaranteed invocation, no LLM dependency

**Cons:**
- Complex - requires direct tool invocation API
- May conflict with rpiv-todo's internal state management

**Status:** Not viable without access to tool executor API

## Recommended Implementation: Option A

### Integration Point

Create a new extension in pi-harness-runtime that:
1. Loads rpiv-todo as a dependency
2. Adds system prompt injection on `before_agent_start`
3. Optionally registers custom config for `maxWidgetLines`, `collapseKey`

### File Structure

```
pi-harness-runtime/
├── packages/
│   └── rpiv-todo-auto/
│       ├── src/
│       │   └── index.ts          # Extension entry
│       ├── package.json
│       └── tsconfig.json
```

### package.json dependencies

```json
{
  "name": "@moocoding/rpiv-todo-auto",
  "type": "module",
  "peerDependencies": {
    "@juicesharp/rpiv-todo": "^2.2.0",
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

### Implementation Details

**index.ts:**
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AUTO_INVOKE_HINT = `
Always use the todo tool at the START of every session to capture user requirements before beginning work.
When the user gives you a task, immediately create todo items for each step.
Keep tasks updated - mark in_progress when working, completed when done.
`;

export default function (pi: ExtensionAPI) {
  // Inject hint into system prompt
  pi.on("before_agent_start", async (event) => {
    event.systemPrompt += AUTO_INVOKE_HINT;
  });

  // Optional: Register custom config
  // pi.registerConfig({ maxWidgetLines: 10, collapseKey: "ctrl+shift+t" });
}
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `autoInvokeHint` | "Always use todo..." | Custom hint text |
| `firstMessageOnly` | `true` | Only inject on first message |
| `maxWidgetLines` | `12` | Pass through to rpiv-todo |

## Alternative: Fork rpiv-todo

If Option A doesn't work reliably, consider forking rpiv-todo to add:
1. `autoInvoke` config option
2. Direct `agent_start` hook that auto-invokes `todo.list()` or creates a "Session started" task

## Testing

1. Start new session with empty conversation
2. Type: "Fix the login bug"
3. Verify todo tool is called automatically
4. Verify overlay shows captured tasks

## Future Enhancements

1. **Task templates**: Auto-create common task structures
2. **Context awareness**: Different hints for different task types
3. **Persistence**: Save todo state to disk for cross-session continuity
