# todo-bd-sync: Two-Way Sync Between rpiv-todo and bd

## Overview

`todo-bd-sync` provides seamless synchronization between:

- **rpiv-todo**: Visual todo overlay in pi-coding-agent TUI
- **bd**: Distributed graph issue tracker (beads)

## Features

- **Auto-enable**: Automatically activates when rpiv-todo is installed
- **Two-way sync**: Changes in either system sync to the other
- **Conflict resolution**: Most recent change wins
- **ID mapping**: Tasks are linked via `metadata.bdId`
- **Session start sync**: Loads existing bd issues into todo overlay
- **Auto-reminder**: After completing a task, prompts LLM to continue with remaining todos
  - **NOTE**: Reminder is **DISABLED by default** (see below)

### Auto-Reminder Behavior

**STATUS**: The auto-reminder is currently **DISABLED** due to reminder spam causing transcript growth.

**What was broken**:

- Reminders used global `bd ready` output instead of scoped tasks
- Reminders triggered on every `bash` command during analysis sessions
- Reminders used `followUp` delivery (appended to transcript) instead of `steer`
- Only a 5-second time throttle, no content deduplication

**To enable reminders** (after proper scoping is implemented):

```typescript
const reminder = createCustomReminder(pi, () => getScopedTasks(), {
  autoRemind: true,  // NOT the default
  deliverAs: "steer", // avoids transcript growth
});
```

## Installation

> **Important:** `bd` is **not** implemented or bundled by `pi-harness-runtime`.
> This package integrates with the external upstream **Beads CLI**:
> `https://github.com/gastownhall/beads`
>
> Install `bd` system-wide from upstream, then initialize it in your own project.

### 1. Install rpiv-todo

```bash
pi install npm:@juicesharp/rpiv-todo
```

### 2. Install bd (if not already installed)

```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash

# Or via npm
npm install -g @beads/bd

# Verify installation
bd --version
```

### 3. Initialize bd in your project

```bash
cd your-project
bd init

# Optional: install richer instructions for your agent
bd setup codex    # Codex CLI - installs skill, AGENTS.md guidance, and hooks
bd setup claude   # Claude Code - installs hooks/settings
bd setup factory  # Factory.ai Droid - creates/updates AGENTS.md
```

### 4. Create tasks with `bd create`

```bash
# Create a simple task
bd create "Build API" -p 2

# Create with description
bd create "Build API" -d "Create REST endpoints" -p 2

# Create child task (subtask)
bd create "Add tests" --parent bd-xxx -p 2

# Create with labels
bd create "Deploy" -l "production" -p 1

# List tasks
bd list

# Get JSON output
bd ready --json
```

## How It Works

### Sync Flow

```
┌─────────────────────────────────────────────────────────────┐
│  User types prompt                                          │
│      │                                                     │
│      ▼                                                     │
│  "todo-list" auto-injected to prompt                       │
│      │                                                     │
│      ▼                                                     │
│  rpiv-todo activates → LLM uses `todo` tool                │
│      │                                                     │
│      ▼                                                     │
│  ┌──────────────────────────────────────┐                   │
│  │  todo-bd-sync intercepts todo calls  │                   │
│  └──────────────────────────────────────┘                   │
│      │                                                     │
│      ├──────────────────────────────┐                       │
│      ▼                              ▼                       │
│  rpiv-todo                     bd (persistent)              │
│  (visual overlay)              (issue tracker)               │
└─────────────────────────────────────────────────────────────┘
```

### Sync Triggers

| Event | Direction | Action |
|-------|-----------|--------|
| `todo create` | → bd | Create bd issue |
| `todo update` | → bd | Update bd issue status |
| `todo delete` | → bd | Close bd issue |
| `bd create` | ← bd | Note for future sync |
| `bd update/close` | ← bd | Update sync timestamp |

### Conflict Resolution

When both systems modify the same task:

- Most recent change wins (based on timestamp)
- `metadata.lastSync` tracks last sync time

## Usage

### Automatic (No Commands Needed)

Once installed and dependencies are met, sync happens automatically:

1. User types any prompt
2. `todo-list` is auto-injected → rpiv-todo activates
3. LLM uses `todo` tool for multi-step tasks
4. Tasks appear in overlay AND sync to bd

### Manual Commands

| Command | Description |
|---------|-------------|
| `/bd-todo-sync` | Force sync all mapped tasks |
| `/bd-todo-status` | Show sync status and dependencies |

## Configuration

```typescript
// In pi-harness-runtime
const sync = createTodoBdSync(pi, {
  autoInjectPrompt: true,      // Inject "todo-list" to prompt
  syncDirection: "both",       // both, todoOnly, bdOnly
  loadOnSessionStart: true,    // Load existing bd issues
  debug: false,                // Debug logging
});

// Reminder is DISABLED by default
// Enable only after proper task scoping:
const reminder = createCustomReminder(pi, () => getScopedTasks(), {
  autoRemind: true,
  deliverAs: "steer",  // does NOT append to transcript
});
```

## Data Storage

### ID Mapping

Stored in memory during session. Maps:

```
todo ID (number) ↔ bd ID (string like "bd-a1b2")
```

### Task Metadata

Each synced task stores:

```json
{
  "id": 1,
  "subject": "Implement feature X",
  "status": "in_progress",
  "metadata": {
    "bdId": "bd-a1b2",
    "lastSync": 1709234567890
  }
}
```

## Dependencies

### Required

- **bd CLI** - Issue tracker backend
  - Install: `curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash`
  - Version: Any recent version

### Optional

- **@juicesharp/rpiv-todo** - Visual todo overlay
  - Install: `pi install npm:@juicesharp/rpiv-todo`
  - If not installed: Uses fallback mode (limited functionality)

## Troubleshooting

### "bd CLI not found"

```bash
# Install bd
curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash

# Verify
which bd
bd --version
```

### "rpiv-todo not showing overlay"

```bash
# Install rpiv-todo
pi install npm:@juicesharp/rpiv-todo

# Restart pi
```

### Check Status

```
/bd-todo-status
```

Expected output:

```
=== todo-bd-sync Status ===
rpiv-todo: installed
bd: installed (x.x.x)
Mappings: 0
Enabled: true
```

## Architecture

```
packages/todo-bd-sync/
├── src/
│   ├── index.ts          # Main API
│   ├── extension.ts       # pi-coding-agent extension entry
│   ├── detector.ts        # Dependency detection
│   ├── sync.ts           # Two-way sync logic
│   ├── types.ts          # TypeScript types
│   └── todo-reminder.ts  # Reminder system (DISABLED by default)
└── package.json
```

## Known Issues

- [x] Reminder spam causing transcript growth — **FIXED**: reminder disabled by default
- [ ] Persist ID mappings across sessions
- [ ] Bidirectional real-time sync
- [ ] Conflict resolution UI
- [ ] Bulk sync commands
