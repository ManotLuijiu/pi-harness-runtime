# Pi Harness Runtime

[![Beta](https://img.shields.io/badge/version-1.1.16-orange?style=for-the-badge)](https://github.com/ManotLuijiu/pi-harness-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-macOS%20|Linux-blue?style=for-the-badge)]()

> !️ **Beta Notice — Not Production Ready !️**
> This project is in active development. Core features work.

**Autonomous AI coding harness for pi: local token tracking + provider mirror + task orchestration.**

## Two Flavors

### 1. `/usage` — Token Tracking (stable ✅)

Codex-style usage tracking with local tokens + provider mirror.

### 2. `/harness` — Autonomous Coding Loop (beta 🔨)

Give the runtime a requirement. It keeps working, survives interruption, and returns with code ready for review.

## Install

```bash
pi install npm:pi-harness-runtime
```

### Recommended Extensions

This runtime works best with these extensions (auto-installed by pi-harness-runtime):

```bash
pi install npm:pi-subagents     # Sub-agent orchestration for large refactors
pi install npm:pi-mcp-adapter    # MCP protocol adapter for external tools
pi install npm:@juicesharp/rpiv-todo  # Task tracking with bd sync
```

The `pi-subagents` extension enables delegation assessment and parallel task execution for large refactoring work (10+ files, 50+ call sites).

The `reverse-engineer-anything` skill (via `rea-agents`) enables reverse engineering of binaries, packages, firmware, and browser targets. Skills are not shipped with this package: they are loaded from your own skill store (`~/.pi-harness-runtime/skills`) and from your own Qdrant collection.

Requires Pi v0.37.3+.

### Headless Server Setup (herdr clipboard bridge)

If running on a **headless server** via herdr SSH, install the clipboard bridge plugin to enable copy/paste between server and local machine:

```bash
# 1. Link the plugin (already included in this package)
cd ~/.config/herdr/plugins
ln -s ~/.config/herdr/plugins/moocoding.clipboard-bridge moocoding.clipboard-bridge 2>/dev/null || true

# 2. Add keybindings to ~/.config/herdr/config.toml
cat >> ~/.config/herdr/config.toml << 'EOF'

[[keys.command]]
key = "prefix+y"
type = "plugin_action"
command = "moocoding.clipboard-bridge.copy"
description = "Copy selected text via bridge"

[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "moocoding.clipboard-bridge.paste"
description = "Paste from clipboard bridge"
EOF

# 3. Reload herdr config
herdr server reload-config
```

### todo-bd-sync (Auto Task Tracker)

Automatic two-way sync between rpiv-todo overlay and bd issue tracker.

When you use `bd` for issue tracking, this feature automatically syncs tasks.

> **Important:** `bd` is **not** implemented or bundled by `pi-harness-runtime`.
> It is the external **Beads CLI** from the upstream project:
> `https://github.com/gastownhall/beads`
>
> Install it system-wide from upstream, then initialize it in your own project:

```bash
# Install beads CLI (system-wide - don't clone this repo into your project)
curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash

# Initialize in YOUR project
cd your-project
bd init

# Optional: refresh or install richer instructions for your agent
bd setup codex    # Codex CLI - installs skill, AGENTS.md guidance, and hooks
bd setup claude   # Claude Code - installs hooks/settings
bd setup factory  # Factory.ai Droid - creates/updates AGENTS.md
```

- Install dependencies:

```bash
# Install rpiv-todo overlay
pi install npm:@juicesharp/rpiv-todo

# Verify bd is available from your upstream beads install
bd --version
```

- Works automatically: Just use prompts with multiple steps, and tasks sync to bd
- Manual commands:

```bash
/bd-todo-sync    # Force sync all mapped tasks
/bd-todo-status  # Show sync status
```

> **Note:** Auto-reminder is **disabled by default** (bug fix for transcript growth).
> See [docs/todo-bd-sync.md](docs/todo-bd-sync.md) for details.

## Usage Commands

```bash
/usage              # show full status (local tracking + provider mirror)
/usage refresh     # force refresh quota from provider console
/usage today       # today's usage + 5h window
/usage week        # this week's usage + lifetime totals
/usage reset       # clear provider mirror
/bd-todo-sync      # Force sync all mapped tasks (todo <-> bd)
/bd-todo-status    # Show todo-bd sync status and dependencies
```

## Harness Commands

```bash
/harness start <requirement>   # Start a new harness job (beta)
/harness status               # Show current job status
/harness tasks                # List all tasks
/harness pause                # Pause when quota low
/harness resume               # Resume after quota reset
/harness cancel               # Cancel job
```

## Example Session

```
/harness start Build a REST API with JWT authentication

# Runtime creates task graph:
# task-001: Analyze requirements -> ready
# task-002: Implement API -> depends on task-001
# task-003: Write tests -> depends on task-002
# task-004: Code review -> depends on task-003

/harness status
# Job: job-123, Status: running
# Tasks: 1/4 done, 1 running

# When quota runs low:
/harness pause
# Job paused. Resume when quota resets.

# When quota resets:
/harness resume
# Job resumed. Continue working.

# When all tasks complete:
/harness status
# Job: job-123, Status: ready_for_client
# Tasks: 4/4 done [x]
```

## LangChain Multi-Agent Loop (Autonomous Write-Review)

A **human-on-the-loop** autonomous system where multiple AI agents collaborate on code:

- **GPT** → writes the plan
- **MiniMax** → writes the code
- **GPT/GLM** → reviews the code
- Loop repeats until approved or max iterations hit

### Quick Start

```bash
# One-shot (human triggers once)
bun harness/langchain/run.ts --mode graph --request "implement feature X"

# Dry-run (no API keys, uses stubs)
bun harness/langchain/run.ts --mode graph --request "fix bug Y" --dry-run

# Daemon mode (auto-triggers on new tasks — stays running)
bun harness/langchain/run.ts --daemon
```

### Daemon Mode (Auto-Trigger)

The daemon runs as a **standalone long-running process** and watches for new tasks:

```
┌─────────────────────────────────────────────────────────────────┐
│  Terminal 1: pi-coding-agent (GPT/MiniMax/GLM — your coding agent) │
│  Terminal 2: bun harness/langchain/run.ts --daemon                 │
│  Terminal 3: (optional) second agent                             │
│  Terminal N: (optional) more agents                            │
└─────────────────────────────────────────────────────────────────┘
```

**How it works:**

1. You interact with coding agents in their terminals
2. Agents create tasks via `bd create ...` or inbox files
3. Daemon detects new pending tasks automatically
4. Loop runs: plan → write → review → fix (autonomous, no human relay)
5. Human is notified only at approval gates or when blocked

**Stop the daemon:** `Ctrl+C` or `kill $(pid)`

### Multi-Agent Roles

Request format in task or inbox file:

```
[planner: gpt] [reviewer: GLM] [coder: MiniMax] implement feature X
```

Default (from env vars):

| Role | Default | Env Var |
| ------ | --------- | --------- |
| Planner | GPT | `PLANNER_*` |
| Coder | MiniMax | `MINIMAX_*` |
| Reviewer | GPT | `GLM_*` |

### Architecture

```
Triggers:
  bd tasks ─┐
  inbox ────┼──► Daemon ──► LeaseManager ──► LangGraph Loop
  bus event ─┤         (watchers)              │
  cron ──────┘                                    │
                                                 │
Loop (LangGraph):                           publish
  START → plan(GPT) → write(MiniMax) → review(GPT) ──► HerdrEventBus
                                ↓                              │
                         changes_requested?                    │
                              ↓ yes              no         │
                        fix(MiniMax)            approved ──► Notification
                              ↓                              │
                         review(GPT) ─────────────────────────►
```

### Key Design Invariants

| # | Invariant |
| --- | --- |
| I1 | No step waits for a human unless an approval gate fires |
| I2 | Agents talk directly via graph state + events (no human relay) |
| I3 | Exactly one daemon processes a task at a time (lease-based) |
| I4 | Every transition is observable via HerdrEventBus |
| I5 | Loop always terminates: maxIterations, blocked verdict, or error |
| I6 | Crash-safe: loop state survives daemon restarts (checkpointer) |
| I7 | Human gates are config-driven, default to "notify don't block" |

### Files

```
harness/langchain/
├── run.ts              # CLI entry point (modes: graph, supervisor, daemon)
├── daemon.ts           # Core daemon: watchers + lease + loop orchestration
├── graph.ts            # LangGraph state machine (plan→write→review→fix)
├── agents.ts           # Agent factory (planner, reviewer, coder)
├── model-router.ts     # Smart model routing per request tags
├── ping-pong-middleware.ts  # Decision engine: complex? → loop. simple? → one-shot
├── checkpointer.ts     # Crash-safe state persistence
├── inbox-watcher.ts    # Watches inbox dir for new task files
├── bus-watcher.ts     # Watches HerdrEventBus for task.proposed events
├── cron-watcher.ts    # Stub for scheduled task triggers
├── status-line.ts     # Real-time loop status display
├── surge.ts           # Peak-hour surge detection
└── widget.ts          # TUI widget for loop progress
```

### Wiki Docs

| Doc | Description |
| ----- | ------------- |
| `wiki/auto-trigger-multi-agent.md` | Full daemon spec, event contracts, acceptance tests |
| `wiki/multi-agent-langchain.md` | LangChain/LangGraph design notes |
| `wiki/ping-pong-shared-state.md` | Shared state between agents |

## Architecture

```
pi-harness-runtime/
+-- index.ts                    # Extension entry point
+-- footer-status.ts            # Footer bar renderer (local vs. mirror mode)
+-- mirror.ts                   # Per-provider quota mirror (mirror.json)
+-- harness/
|   +-- job-state-machine.ts   # 14-state lifecycle machine
|   +-- task-graph.ts           # DAG-based task management
|   +-- master-planner.ts       # Requirement -> task graph
|   +-- loop-runtime.ts         # Core execution loop
|   +-- repair-engine.ts        # Auto-fix failures
|   +-- blackboard.ts           # Agent coordination
|   +-- context-window-manager.ts # Context tracking
|   +-- agent-handoff.ts        # Clean agent transitions
|   +-- auto-quota-resume.ts    # 5h quota auto-resume scheduler
|   +-- glm-quota-countdown.ts  # GLM countdown + notifications
|   +-- glm-quota-logger.ts     # Structured GLM quota logging
|   +-- notification-events.ts  # LINE/mobile notifications
|   +-- e2e/
|   |   +-- minimax-quota-scraper.ts  # Playwright MiniMax scraper
|   |   +-- glm-quota-scraper.ts       # GLM API quota scraper
|   |   +-- playwright-runner.ts       # Browser automation
|   +-- project-detector/
|       +-- detector.ts         # Auto-detect project type
+-- packages/
|   +-- cookie-sanitizer/       # Live cookie-file sync via chokidar
|   +-- providers/              # MiniMax, OpenAI, Codex adapters
|   +-- quota-manager/          # Quota signal collection
|   +-- auth/                   # MiniMax browser auth
|   +-- worktree/              # Git worktree per task
+-- skills/
    +-- harness-runtime/
        +-- SKILL.md           # Skill documentation
```

## Job State Machine

```
created -> planning -> queued -> running -> testing -> reviewing
    v        v         v        v         v
cancelled  blocked   waiting_human  repairing  ready_for_client
                                        v            v
                                  paused_quota    archived
```

## Key Features

- **Resumable**: Every state change is checkpointed to disk
- **Quota-aware**: Detects quota exhaustion, pauses, resumes after reset
- **GLM Auto-Resume**: Parses 429 errors, countdown timer, notifications at 15/5/1 min, auto-resume before reset
- **Provider-agnostic**: MiniMax, OpenAI, GLM, Claude adapters
- **Task DAG**: Dependencies tracked, topological execution
- **Auto-repair**: Failure classification + retry with exponential backoff
- **E2E testing**: Scenario-based Playwright integration (coming soon)
- **Project detection**: Auto-detects Frappe, Next.js, React, Django, Laravel
- **Per-provider mirror**: Each LLM provider maintains its own quota record
- **Structured logging**: GLM quota events logged to `~/.pi/harness-logs/glm-quota.log`

## Data Directory

All data stored locally in `~/.pi/`:

```
~/.pi/
+-- usage-status/         # /usage data
|   +-- usage.jsonl
|   +-- mirror.json        # per-provider quota mirror
+-- harness/            # /harness data
|   +-- jobs/
|   |   +-- <job-id>/
|   |       +-- checkpoint.json
|   |       +-- events.jsonl
|   |       +-- task-graph.json
|   |       +-- blackboard/
|   |       +-- repair-tasks.jsonl
|   +-- inbox/           # task inbox (RFC-0101)
+-- harness-logs/       # GLM quota logs
|   +-- glm-quota.log    # countdown, auto-resume, notifications
+-- okf/               # (optional) Your custom OKF knowledge
```

Credentials live in their own directory, `~/.pi-harness-runtime/keys/` — one file
per secret, never in the repository. Common key files:

```
~/.pi-harness-runtime/keys/
+-- telegram-bot-token.txt       # Telegram bot token
+-- telegram-webhook-url.txt    # Public HTTPS URL of the Telegram webhook
+-- telegram-webhook-secret.txt # Webhook secret (x-telegram-bot-api-secret-token)
+-- telegram-allowed-users.txt  # Allowed Telegram user ids (comma-separated)
+-- telegram-chat-id.txt        # Legacy single allowed user id
+-- relay-auth-token.txt        # Relay WebSocket auth token
+-- relay-ws-url.txt            # Relay WebSocket URL (optional)
+-- line-access-token.txt       # LINE channel access token (LINE only)
+-- line-user-id.txt            # LINE user id (the extension only)
+-- line-channel-secret.txt     # LINE channel secret (webhook server only)
+-- typesafe-api-key.txt        # Jev / TypeSafe API key
+-- openrouter-api-key.txt      # Jev / OpenRouter API key (fallback provider)
+-- jev-api-key.txt             # Legacy Jev key (OpenRouter `sk-or-…` or TypeSafe)
```

This is a subset. The complete map is spread over the places the harness reads
the credentials from: `harness/key-loader.ts` (KEY_FILE_MAP — the model and
storage keys the langchain runner loads into the environment),
`harness/telegram-auth.ts`, `index.ts` and `scripts/unified-webhook-server.ts`
(the Telegram and LINE credentials the extension and the webhook server read
from disk) and `packages/relay/src/relay-endpoint.ts` (RELAY_URL_SOURCES /
RELAY_TOKEN_SOURCES — the relay endpoint and token).

Two places can name the same credential with different files: the key-loader
map is what the **langchain runner** loads into the environment, while the
extension reads its own files (`qdrant-cluster-url.txt`, not
`qdrant-cluster-endpoint.txt`; `telegram-bot-token.txt`, not a mapped
variable). The startup fix commands always name the file the running code
actually reads.

See [Relay Setup](#relay-setup-two-way-telegram-stream) for the `echo` commands that
create the relay and Telegram key files.

## Custom OKF Knowledge (Optional)

Create `~/.pi/okf/` to add your custom knowledge that the runtime reads during context compilation:

```
~/.pi/okf/
+-- <skill-name>.md      # Your custom skill/procedure
+-- <domain>.md          # Domain-specific knowledge
+-- <project>.md        # Project-specific rules
```

The runtime automatically detects and reads these files. If the folder doesn't exist, compilation proceeds without them.

**Example:**

```markdown
# my-custom-skill

## When to use

This skill applies when...

## Procedure

1. Step one
2. Step two
```

See `packages/context-compiler/` for how OKF concepts are loaded.

## Safety Properties

- ✅ **Local-first**: All data stays on disk
- ✅ **No credentials stored**: No passwords, tokens, or cookies
- ✅ **Human-on-the-loop**: Clear intervention points
- ✅ **Checkpointed**: Resume from any state
- ✅ **Idempotent**: Safe to run multiple times

## Testing

```bash
bun test   # ~1500+ tests across harness and packages
```

## Automatic Quota Fetching

Quota data is automatically surfaced per-provider:

| Provider | Source | Notes |
| --- | --- | --- |
| MiniMax | Live cookie-file watch + Playwright scrape | Drop folder: `~/.pi-harness-runtime/cookies/` |
| OpenAI / OpenAI Codex | TUI message capture | Signal on first limit hit |
| GLM (Z.ai / Zhipu) | TUI message capture | Signal on first limit hit |
| Anthropic | TUI message capture | Signal on first limit hit |
| OpenRouter | TUI message capture | Signal on first limit hit |
| Other / unknown | (no data — footer shows hint) | — |

The footer line carries the provider label, so you always know which LLM the data is from:

```
MiniMax:  5h: 92% left · week: 80% left              # continuous (cookie scrape)
OpenAI:   5h: -- · week: -- (no signal yet)          # pending first limit hit
GLM:      5h quota hit, resets Aug 25 01:47          # TUI signal with countdown
GLM:      ⏳ 4h 32m (5h quota)                      # active countdown
```

### GLM Auto-Resume with Countdown

When GLM 5h quota is exhausted (429 error), the runtime:

1. **Parses the reset time** from the error message (e.g., `"reset at 2026-08-25 01:47:16"`)
2. **Starts a countdown timer** showing time until reset
3. **Sends notifications** at 15min, 5min, and 1min before reset
4. **Auto-resumes** the job 10 seconds before reset time
5. **Logs all events** to `~/.pi/harness-logs/glm-quota.log`

#### Log File Location

```bash
~/.pi/harness-logs/glm-quota.log
```

#### Log Levels

| Level | Events |
| ------- | -------- |
| `INFO` | Countdown started, ticks, resume triggered, notifications sent |
| `WARN` | Notification failed, mirror update failed, parse error |
| `ERROR` | Auto-resume failed, critical errors |

#### Log Format

```
[2026-08-25T01:47:00.000Z] [INFO] [job-001] Countdown started: 4h 32m until 2026-08-25T06:19:00.000Z
[2026-08-25T01:48:00.000Z] [INFO] [job-001] Notification sent: 15 minutes before reset
[2026-08-25T06:18:50.000Z] [INFO] [job-001] Countdown complete, triggering auto-resume
[2026-08-25T06:18:51.000Z] [INFO] [job-001] Auto-resume succeeded, job resumed
```

#### View Logs

```bash
# Tail the log in real-time
tail -f ~/.pi/harness-logs/glm-quota.log

# View recent entries
tail -50 ~/.pi/harness-logs/glm-quota.log

# Filter by job
grep "job-001" ~/.pi/harness-logs/glm-quota.log

# Filter by errors only
grep "\[ERROR\]" ~/.pi/harness-logs/glm-quota.log
```

### MiniMax Setup (one-time)

The runtime watches `~/.pi-harness-runtime/cookies/` for cookie files. Drop any cookie export there — it syncs within ~1 second:

1. **Install EditThisCookie** Chrome extension -> export from `platform.minimax.io`
2. **Create the drop folder:**

   ```bash
   mkdir -p ~/.pi-harness-runtime/cookies
   ```

3. **Drop your cookie file in the folder** — any filename, any format (Netscape `.txt` or EditThisCookie JSON `.json`):

   ```bash
   cp ~/Downloads/platform.minimax.io_cookies.txt \
      ~/.pi-harness-runtime/cookies/
   # …or use the EditThisCookie JSON export — same folder works.
   ```

   The `cookie-sanitizer` package (`@pi-harness/cookie-sanitizer`) runs chokidar on this
   folder, normalizes everything to standard Netscape, and writes the canonical cache at
   `~/.config/minimax-cookies.txt`. Live update latency: <1 second after drop.

4. **Done!** Quota auto-refreshes every ~15 minutes. Cookie file changes sync immediately.

**Override:** set `QUOTA_COOKIE_FILE=/path/to/your/cookies.txt` to bypass the sanitizer
and read a specific file directly.

### Jev API Key Setup (Auto-Continue)

Jev enables autonomous agent decisions when you're unavailable. Set the API key once and it persists:

```bash
echo "your_jev_api_key_here" > ~/.pi-harness-runtime/keys/jev-api-key.txt
```

Get your Jev API key from: https://openrouter.ai/keys

**Priority:** `TYPESAFE_API_KEY` env > `OPENROUTER_API_KEY` env > `~/.pi-harness-runtime/keys/jev-api-key.txt`

## LangChain Ping-Pong Loop Setup

The LangChain loop runs planner (GPT) → coder (MiniMax) → reviewer (GLM) → fix → approve. **Models are auto-detected from your existing `/model` configuration in pi** — no extra setup needed for model names.

### 1. Configure models — use `/model` in pi

pi-harness-runtime reads models from `~/.pi/agent/models-store.json`. Use `/model` in pi to add:
- **Planner**: GPT model (provider: OpenAI-compatible, e.g. `openai-codex`)
- **Reviewer**: GLM model (provider: Z.ai)
- **Coder**: MiniMax model (provider: MiniMax)

### 2. API Keys — in `~/.pi-harness-runtime/keys/`

```bash
echo "{planner-api-key}" > ~/.pi-harness-runtime/keys/planner-api-key.txt
echo "{reviewer-api-key}" > ~/.pi-harness-runtime/keys/reviewer-api-key.txt
echo "{coder-api-key}" > ~/.pi-harness-runtime/keys/coder-api-key.txt
# optional: for LangSmith tracing
echo "{langsmith-key}" > ~/.pi-harness-runtime/keys/langsmith-api-key.txt
```

The startup summary scans `~/.pi-harness-runtime/keys/` and lists the missing
credentials of every feature that has a startup line (Telegram, Relay, LINE,
Jev, Qdrant, Honcho) together with the exact command that creates them — each
command line is prefixed with `Fix:`:

```text
├─ [WARN] Relay: two-way streaming off; no relay endpoint configured
│  Fix: echo "<TOKEN>" > ~/.pi-harness-runtime/keys/relay-auth-token.txt
│  Fix: echo "<SECRET>" > ~/.pi-harness-runtime/keys/telegram-webhook-secret.txt
│  Fix: echo "<WS_URL>" > ~/.pi-harness-runtime/keys/relay-ws-url.txt
│  Fix: echo "<WEBHOOK_URL>" > ~/.pi-harness-runtime/keys/telegram-webhook-url.txt
│  Then reload Pi.
```

A credential counts as present when its key file exists and is **not** empty,
or when the environment variable it is read from is set (a credential the
extension reads from a file only — the Telegram bot token and chat id — is
not satisfied by an exported variable). A file that exists but is empty is
reported with the same command plus an `# the file exists but is empty - the
command replaces it` note (only the primary file carries that note — an
alternative file that does not exist yet is simply missing). A value the
reader would reject counts as
missing as well: a key file with five characters or less is ignored by the
skills loader, a Jev key with ten characters or less by the judge, and an
allowed-user list without a single usable id is not a user list. Such a file
is reported with an `# the file exists but the value is not accepted - the
command replaces it` note.

**Scope of the summary.** The audit covers the credentials of the features
that have a startup line — Telegram, Relay, LINE, Jev, Qdrant and Honcho.
The LINE channel secret (`line-channel-secret.txt`) is **not** part of it: it
is only needed on the machine that runs the webhook server and no startup
line owns it, so it is never reported as missing. Optional integrations
without a startup line (for example Paperclip) are not part of the summary
either; they write their own hint to the log file.

**Narrow terminals.** A fix command that is too long for the terminal is
split — the directory to create and the command itself — so that nothing
is cut off in the middle of a path. The split form creates the key
directory first (`mkdir -p`) and keeps the full path in the redirect, so it
works whether or not the directory exists and it does not change the working
directory of your shell. When even that does not fit, the redirect moves
onto a line of its own (with a backslash continuation, so the shell still
runs it as one command):

```text
├─ [WARN] Relay: two-way streaming off; no relay endpoint configured
│  Fix: mkdir -p ~/.pi-harness-runtime/keys
│       echo "<TOKEN>" > ~/.pi-harness-runtime/keys/relay-auth-token.txt
│  Then reload Pi.
```

A command is never cut off: a broken path is worse than a long line.

**A file that is already there is never overwritten silently.** When the
summary shows a command for a file that exists, the command says that it
replaces the file. When the audit cannot tell whether the value in the file
is usable, the summary points at the file instead of offering an `echo`
that would replace a working secret with a placeholder.

The fix commands of each feature:

| Feature | Key files the fix commands create | Environment variable |
| --- | --- | --- |
| Telegram | `telegram-bot-token.txt`, `telegram-chat-id.txt`, `telegram-allowed-users.txt` | — (bot token and chat id: files only; the allowlist also accepts `TELEGRAM_ALLOWED_USERS`) |
| Relay | `relay-auth-token.txt` (or `telegram-webhook-secret.txt`), `relay-ws-url.txt` (or `telegram-webhook-url.txt`) | `RELAY_AUTH_TOKEN`, `RELAY_WS_URL` |
| LINE | `line-access-token.txt`, `line-user-id.txt` | — (files only) |
| Jev | `typesafe-api-key.txt` (or `openrouter-api-key.txt`, or the legacy `jev-api-key.txt`) | `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY` |
| Qdrant | `qdrant-cluster-url.txt`, `qdrant-api-key.txt`, `openai-api-key.txt` | `QDRANT_CLUSTER_ENDPOINT`, `QDRANT_API_KEY`, `OPENAI_API_KEY` |
| Honcho | `honcho-api-key.txt` | — (file only) |

Only the missing part is listed: a relay that has a URL but no token shows
the token command alone. The Relay and the LINE line are optional features:
they only appear when the user is actually using them — a relay key file
(or the webhook url the relay url is derived from) exists, or the Telegram
channel works. A user who never touches them sees no warning on every
start. The LINE warning only appears once a
`line-access-token.txt` or a `line-user-id.txt` file exists: a user who never
touches LINE does not see a warning on every start. The LINE line only turns
green when the channel was really started in that run — after you create the
LINE key files, reload Pi once, otherwise the line says
`configured; reload Pi to enable the channel` (or
`configured; Telegram must be configured first` when the LINE channel cannot
start because Telegram is not configured yet).

The audit never prints a credential value — only the placeholder. Secrets
managed by [Infisical](#3-infisical-secrets-optional--centralized-key-management)
are not covered: the audit looks at the key files and the environment only.

**When the summary refreshes.** The Relay and LINE lines are re-checked when
a session starts, so they follow the key files immediately. The LINE
*channel* is only started once per load — after you create the LINE key
files, reload Pi once, otherwise the line says `configured; reload Pi to
enable the channel` (or `configured; Telegram must be configured first` when
a reload cannot help because Telegram is missing). The other lines
(Telegram, Jev, Qdrant, Honcho) describe the state at load time — the
features are initialised once per load, so a new key file needs a reload
before the line changes. That is why every fix command ends with
"Then reload Pi."

### 3. Infisical Secrets (Optional — Centralized Key Management)

For centralized secret management via Infisical Cloud:

```bash
# Auto-creates ~/.pi-harness-runtime/infisical/ on first run

# Create config
cat > ~/.pi-harness-runtime/infisical/config.json << 'EOF'
{
  "schemaVersion": 1,
  "enabled": true,
  "site": "us",
  "projectId": "YOUR_PROJECT_ID",
  "environment": "production",
  "secretPath": "/harness",
  "authMethod": "universal",
  "bootstrapRef": { "type": "env", "name": "INFISICAL_CLIENT_SECRET" },
  "services": [
    { "service": "jev", "required": true, "keys": { "TYPESAFE_API_KEY": "TYPESAFE_API_KEY" } }
  ],
  "sourcePolicy": { "remoteAuthoritative": true, "envOverride": false }
}
EOF

# Set bootstrap credentials
export INFISICAL_CLIENT_ID="your-client-id"
export INFISICAL_CLIENT_SECRET="your-client-secret"

# Refresh secrets
/setup-infisical refresh
```

Commands:
- `/setup-infisical status` — Show current status
- `/setup-infisical test` — Test Varlock connectivity
- `/setup-infisical refresh` — Refresh secrets from Infisical
- `/setup-infisical disable` — Disable and use file-based keys

### Usage

After reload, use the slash command:

```
/langchain implement user authentication module
```

## PaperClip Integration (Smart Listener)

PaperClip can intelligently interpret user responses (Yes/No/Open questions) from Telegram and route them appropriately.

### Setup

After setting up PaperClip on your server:

```bash
# Create keys directory
mkdir -p ~/.pi-harness-runtime/keys

# Option 1: JSON config (recommended for multiple settings)
cat > ~/.pi-harness-runtime/keys/paperclip-config.json << 'EOF'
{
  "apiKey": "your-agent-api-key-here",
  "baseUrl": "https://paperclip.example.com/api",
  "companyId": "your-company-id"
}
EOF

# Option 2: Individual files
# echo "your-agent-api-key-here" > ~/.pi-harness-runtime/keys/paperclip-api-key.txt
# echo "https://paperclip.example.com/api" > ~/.pi-harness-runtime/keys/paperclip-base-url.txt
```

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PaperClip (control plane)                                  │
│  - Smart interpretation of responses                         │
│  - Routes tasks to appropriate agents                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  pi-harness inbox watcher                                   │
│  - Polls PaperClip for assigned tasks                       │
│  - Routes to pi.dev                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## herdr Integration (Clipboard Bridge)

> **⚠️ This only applies when using herdr.dev**
>
> If you're using a normal terminal (iTerm2, Terminal.app, etc.), clipboard works fine — no special setup needed.

When running on a **headless server via herdr.dev**, clipboard operations need special setup because:

- herdr's `copy_on_select` uses OSC52 which fails in VS Code's integrated terminal PTY
- UTF-8 box-drawing characters (`┌─┐│└`) get corrupted to garbled text
- Server-side clipboard tools (`xclip`, `wl-copy`) don't exist

### Quick Setup

```bash
# Copy the example config (includes clipboard bridge keybinding)
cp config.toml.example ~/.config/herdr/config.toml

# Reload herdr config
herdr server reload-config
```

### Usage

1. **Select text** with mouse in herdr terminal
2. Press **`prefix+y`** (prefix is `ctrl+b` by default)
3. Text is copied via the bridge to your local clipboard

### How It Works

```
Select text in herdr
        ↓
Press prefix+y (plugin action)
        ↓
~/.herdr-clipboard (bridge file)
        ↓
SSH reverse tunnel or tmux buffer
        ↓
Your local machine clipboard
```

### Files

| File | Purpose |
| ------ | --------- |
| `config.toml.example` | Template for `~/.config/herdr/config.toml` |
| `~/.herdr-clipboard` | Bridge file between herdr and clipboard |
| `~/.config/herdr/plugins/moocoding.clipboard-bridge/` | herdr plugin |

### LINE Notification Setup

Get notified on your phone when tasks complete! LINE notifications via the LINE Messaging API.

> **Self-Hosting Required**: LINE webhooks require your own server. This is NOT a hosted service.
> You must **clone this repository** and deploy your own webhook server. See [LINE Voice/Webhook Setup](#line-voicewebhook-setup) below.

#### Step-by-Step Setup

**1. Create a LINE Messaging API channel**

1. Go to [LINE Developers Console](https://developers.line.biz/)
2. Log in with your LINE account
3. Click **Create a channel** → select **Messaging API**
4. Fill in the required fields (channel name, description, etc.)
5. Once created, go to the **Messaging API** tab

**2. Get your Channel Access Token**

1. In the Messaging API tab, scroll to **Long-term channel access token**
2. Click **Issue** to generate the token
3. Copy the token (starts with `eyJ...`)

**3. Get your User ID**

1. Go to your channel's **Basic settings** tab
2. Find **Your user ID** (a long alphanumeric string like `U123456...`)
3. Copy this ID

#### Configuration

Add to your `config.toml`:

```toml
[notification.line]
enabled = true
channelAccessToken = "YOUR_CHANNEL_ACCESS_TOKEN"  # from Messaging API tab
userId = "YOUR_USER_ID"                           # from Basic settings tab
```

#### How It Works

```
Task event triggered (e.g., TaskCompleted)
        ↓
Notification payload created with event details
        ↓
LineAdapter.send() called
        ↓
POST to https://api.line.me/v2/bot/message/push
        ↓
Push notification sent to your LINE app
```

#### Supported Events

| Event | Emoji | Description |
| ------- | ------- | ------------- |
| `JobStarted` | 🚀 | Job execution started |
| `TaskCompleted` | ✅ | Task completed successfully |
| `TaskFailed` | ❌ | Task failed with error |
| `QuotaPaused` | ⏸️ | Quota limit reached, countdown started, auto-resume pending |
| `ResumeScheduled` | ▶️ | Resume scheduled |
| `ContextCompacted` | 📦 | Context window compacted |
| `OutputLimitContinued` | 🔄 | Output limit exceeded, continued |
| `E2EFailed` | 🧪 | E2E test failed |
| `HumanReviewNeeded` | 👤 | Human review required |
| `ReadyForClient` | 🎉 | All tasks done, ready for new work |
| `JobCancelled` | 🚫 | Job was cancelled |
| `Error` | ⚠️ | Runtime error occurred |

#### Example Notification

```
✅ Task Completed

Implement login flow

Task: Implement login flow
Job: feature-auth
```

### LINE Voice/Webhook Setup (Voice Commands)

> **Self-Hosting Required**: LINE voice messages require your own server with HTTPS.
> This is NOT a hosted service. You must **clone this repository** and deploy your own webhook server.

Voice messages from LINE are transcribed via OpenAI Whisper API and executed as commands.

#### Requirements

- **Own server** (VPS, cloud VM) with public IP
- **Domain** with DNS A record pointing to your server
- **SSL certificate** (Let's Encrypt via certbot)
- **Clone this repository** on your server

#### Setup Steps

**1. Clone and Build**

```bash
# Clone on your server
git clone https://github.com/ManotLuijiu/pi-harness-runtime.git
cd pi-harness-runtime
bun install
bun run build
```

**2. Configure DNS**

Create an A record: `line-api.your-domain.com` → `YOUR_SERVER_IP`

**3. Setup Nginx + SSL**

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Create nginx config
sudo tee /etc/nginx/sites-available/line-api.your-domain.com > /dev/null << 'NGINX'
server {
    listen 80;
    server_name line-api.your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:3900;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
NGINX

# Enable and get SSL
sudo ln -sf /etc/nginx/sites-available/line-api.your-domain.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d line-api.your-domain.com --noninteractive --agree-tos -m admin@your-domain.com --redirect
```

**4. Configure LINE Webhook**

```bash
# Set credentials
mkdir -p ~/.pi-harness-runtime/keys

# Get from LINE Developers Console > Messaging API > Basic settings
cp YOUR_ACCESS_TOKEN ~/.pi-harness-runtime/keys/line-access-token.txt
cp YOUR_CHANNEL_SECRET ~/.pi-harness-runtime/keys/line-channel-secret.txt

# Get from LINE Developers Console > Messaging API > Webhook URL
# Set to: https://line-api.your-domain.com/webhook/line
```

**5. Create Webhook Server**

```bash
# Create startup script
mkdir -p ~/line-webhook
cp pi-harness-runtime/packages/voice-api/dist/*.js ~/line-webhook/

# Run server
bun run ~/line-webhook/server.ts
```

**6. Set Webhook URL in LINE Console**

1. Go to LINE Developers Console → Messaging API → Messaging settings
2. Set Webhook URL: `https://line-api.your-domain.com/webhook/line`
3. Click Verify

#### Systemd Service (Auto-Restart)

```bash
sudo tee /etc/systemd/system/line-webhook.service > /dev/null << 'SERVICE'
[Unit]
Description=LINE Webhook Server for pi-harness
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/line-webhook
ExecStart=/home/YOUR_USER/.bun/bin/bun run /home/YOUR_USER/line-webhook/server.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable line-webhook.service
sudo systemctl start line-webhook.service
```

### Other Providers

No setup needed. The runtime reads TUI messages and captures quota-exhaustion signals.
Once any limit is hit (e.g. `OpenAI: context length exceeded, reset in 3 hr 27 min`), the
footer updates immediately and the data persists in `mirror.json`.

## Roadmap

- [x] Core harness infrastructure (job state machine, task graph)
- [x] Master planner
- [x] Repair engine
- [x] Shared blackboard
- [x] MiniMax Web automatic quota detection
- [x] Cookie-file drop folder + live sync (`cookie-sanitizer`)
- [x] Per-provider quota mirror (`mirror.json` keyed by provider)
- [x] Multi-provider TUI signal capture (OpenAI, GLM, Anthropic, OpenRouter)
- [x] LINE notification adapter (Thai mobile notifications)
- [ ] E2E test engine integration
- [ ] Claude adapter
- [ ] Production stress testing
- [ ] RFC-0101: Autonomous Operations Runtime (background execution, task inbox, lease protocol)

## Unified Webhook Server (Telegram + LINE)

Single server handles both Telegram and LINE webhooks on one domain.

> **Self-Hosting Required**: Webhooks require your own server with HTTPS.
> This is NOT a hosted service. Deploy your own webhook server.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│ Your Domain: webhook.your-domain.com                  │
│   ├── /telegram → Telegram webhook                  │
│   ├── /line     → LINE webhook                    │
│   └── /health   → Health check                   │
└─────────────────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────────────────┐
│ Unified Webhook Server (port 8443)                  │
│   ├── Telegram callbacks (approve/reject)           │
│   ├── LINE postbacks (approve/reject)              │
│   └── Text messages → agent                       │
└─────────────────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────────────────┐
│ Local Machine: ~/.pi-harness-runtime/               │
│   └── Callback queue → injects to pi               │
└─────────────────────────────────────────────────────┘
```

### Setup

> For the two-way WebSocket stream (relay server + relay client) see
> [Relay Setup](#relay-setup-two-way-telegram-stream).

1. **Create Telegram Bot**
   ```bash
   # DM @BotFather → /newbot → get token
   echo "YOUR_BOT_TOKEN" > ~/.pi-harness-runtime/keys/telegram-bot-token.txt
   ```

2. **Configure LINE** (if using LINE)
   ```bash
   echo "YOUR_ACCESS_TOKEN" > ~/.pi-harness-runtime/keys/line-access-token.txt
   echo "YOUR_CHANNEL_SECRET" > ~/.pi-harness-runtime/keys/line-channel-secret.txt
   ```

3. **User Authorization**
   ```bash
   echo "123456789" > ~/.pi-harness-runtime/keys/telegram-allowed-users.txt
   ```

4. **Start Unified Webhook Server**
   ```bash
   bun run scripts/unified-webhook-server.ts
   ```

5. **Set Webhook URLs**
   - Telegram: `https://webhook.your-domain.com/telegram`
   - LINE: `https://webhook.your-domain.com/line`

6. **Systemd Service (auto-restart on reboot)**
   ```ini
   [Unit]
   Description=Unified Webhook Server (Telegram + LINE)
   After=network.target

   [Service]
   Type=simple
   User=frappe
   ExecStart=/home/user/.bun/bin/bun run /home/user/unified-webhook-server.ts
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

### NGINX Configuration

```nginx
server {
    server_name webhook.your-domain.com;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/webhook.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/webhook.your-domain.com/privkey.pem;

    location /telegram {
        proxy_pass http://127.0.0.1:8443/telegram;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /line {
        proxy_pass http://127.0.0.1:8443/line;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # The relay WebSocket (two-way Telegram stream) - see "Relay Setup" below
    location /ws {
        proxy_pass http://127.0.0.1:8444/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### User Authorization

Telegram callbacks are validated against an allowlist. Sources checked in order:

1. `TELEGRAM_ALLOWED_USERS` environment variable (comma-separated IDs)
2. `telegram-allowed-users.txt` key file (comma-separated IDs)
3. `telegram-chat-id.txt` (legacy fallback, single ID)

```bash
# Option 1: Environment variable
TELEGRAM_ALLOWED_USERS=123456789,987654321

# Option 2: Key file (~/.pi-harness-runtime/keys/)
echo "123456789,987654321" > ~/.pi-harness-runtime/keys/telegram-allowed-users.txt

# Option 3: Legacy single user
echo "123456789" > ~/.pi-harness-runtime/keys/telegram-chat-id.txt
```

Unauthorized callback queries are rejected before processing.

## Relay Setup (Two-Way Telegram Stream)

The two-way Telegram stream has two halves:

- **Server** — `scripts/unified-webhook-server.ts` receives the Telegram webhook and
  broadcasts every callback to the connected WebSocket clients (relay on `WS_PORT`,
  default `8444`).
- **Client** — `scripts/relay-client.ts` connects to that relay and forwards the
  callbacks into pi (job pipe, Telegram replies).

Both halves resolve the credential from the same key chain
(`packages/relay/src/relay-endpoint.ts`), so — with `RELAY_AUTH_TOKEN` exported in
both shells — the client and the server use the same secret. Only the client
resolves the URL:

| Setting | Resolution order (first match wins) |
| --- | --- |
| WebSocket URL | `RELAY_WS_URL` env → `keys/relay-ws-url.txt` → derived from `keys/telegram-webhook-url.txt` (same host and port, path `/ws`, `https` → `wss`) |
| Auth token | `RELAY_AUTH_TOKEN` env → `keys/relay-auth-token.txt` → `keys/telegram-webhook-secret.txt` |

### 1. Create the key files

Replace the placeholders with your own values — never commit real ones.

```bash
mkdir -p ~/.pi-harness-runtime/keys

# Telegram bot token (from @BotFather)
echo "YOUR_TELEGRAM_BOT_TOKEN" > ~/.pi-harness-runtime/keys/telegram-bot-token.txt

# Public HTTPS URL of your webhook (the reverse proxy in front of the relay)
echo "https://webhook.your-domain.com/telegram" > ~/.pi-harness-runtime/keys/telegram-webhook-url.txt

# The secret the webhook expects in the x-telegram-bot-api-secret-token header
echo "YOUR_TELEGRAM_WEBHOOK_SECRET" > ~/.pi-harness-runtime/keys/telegram-webhook-secret.txt

# Dedicated relay auth token (recommended - keeps it separate from the
# Telegram webhook secret, so one leaked secret does not unlock both)
echo "YOUR_RELAY_AUTH_TOKEN" > ~/.pi-harness-runtime/keys/relay-auth-token.txt

# Allowed Telegram user ids (comma-separated)
echo "123456789,987654321" > ~/.pi-harness-runtime/keys/telegram-allowed-users.txt

# Optional: the relay WebSocket URL. Only needed when it cannot be derived
# from the webhook URL (the relay runs on another host/port or a custom path).
# It must be a plain ws:// or wss:// URL - no credentials, no query string.
echo "wss://relay.your-domain.com:8444/ws" > ~/.pi-harness-runtime/keys/relay-ws-url.txt
```

### 2. Or use environment variables

```bash
# The CLIENT reads RELAY_WS_URL; the SERVER only needs RELAY_AUTH_TOKEN.
# Both processes resolve the environment at startup, so export the token in
# BOTH shells (the server and the client) - otherwise they disagree.
export RELAY_WS_URL="wss://webhook.your-domain.com/ws"   # client only
export RELAY_AUTH_TOKEN="YOUR_RELAY_AUTH_TOKEN"           # server AND client
```

`RELAY_WS_URL` / `keys/relay-ws-url.txt` must be a plain `ws://` or `wss://` URL —
a URL with credentials (`wss://user:pass@host/ws`) or a query string is skipped
with a warning instead of being used.

### 3. Expose the relay through the reverse proxy

The derived URL (`…/ws`) only works when the proxy maps `/ws` to the relay port.
The `location /ws` block is already part of the NGINX `server` block shown in
[NGINX Configuration](#nginx-configuration) — do **not** add it a second time
(nginx rejects a duplicate location). If your NGINX config predates the relay,
copy that block from the NGINX section into your `server` block exactly once.

When the webhook URL addresses the application directly (no proxy in front), the
resolver *warns* about a derived loopback URL (it still returns it) — the relay
listens on `WS_PORT` (default `8444`), not on the HTTP port. Set `RELAY_WS_URL`
or `keys/relay-ws-url.txt` for that setup.

### 4. Start both halves

```bash
# Server: HTTP webhook + WebSocket relay (WS_PORT, default 8444)
bun run scripts/unified-webhook-server.ts

# Client: connects to the relay and forwards the callbacks into pi
bun run scripts/relay-client.ts
```

Without a relay auth token the server does **not** start the WebSocket relay —
callbacks are queued on disk instead.

> **Note:** the token value is never logged, only the name of the source it came
> from (`env RELAY_AUTH_TOKEN`, `keys/relay-auth-token.txt`, …).

## License

MIT © 2026 MooCoding

## Related

- [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) — Underlying pi agent
- [context-mode](https://github.com/MiniMax-AI/context-mode) — Context window tracking
- [pi-web-access](https://github.com/nicobailon/pi-web-access) — Web search for pi

## RFCs

The project tracks 101 design documents:

| RFC | Title | Status |
| ----- | ------- | -------- |
| 0001–0034 | Loop Runtime, Provider Adapter, Quota Manager, Playwright, Git Worktree, Checkpoint, Scheduler, Provider Router, Shared Context, Context Window Manager, Shared Blackboard, Agent Handoff, E2E Test Engine, Project Detector, Job State Machine, Task Graph, Master Planner, Repair Engine, Auto Compact & Continue, Output Token Limit, Partial Response Recovery, Notification Center, Local Browser Agent, Local Runtime Agent, Command Executor, Workspace Manager, Runtime API, Policy Engine, DeepAgents Adapter, Agent Worker Interface, Provider Adapter SDK, Checkpoint Engine, Session Manager | Proposed |
| 0035–0100 | Observability, Roadmap V1, Code Review, Code Generation, Framework Detector, Test Data Generator, Framework Plugin SDK, Prompt Compiler, Context Compiler, Requirement Compiler, Task Compiler, Project Analyzer, Dependency Analyzer, Repo Knowledge Graph, Code Merge Engine, Conflict Resolution, Documentation Generator, Capability Registry, Skill Registry, Model Registry, Cost Optimizer, Performance Optimizer, Evaluation Engine, Learning Engine, Experience Replay, Memory Engine OKF, Frappe/Next.js/React/Django/Laravel/Generic Web Plugins, CLI Plugin SDK, MCP Adapter, A2A Adapter, Codex Adapter, Requirement Intake, Project Bootstrap, Architecture Generator, Sprint Planner, Milestone Manager, Backlog Manager, Human Approval Gate, Release Manager, Version Manager, Deployment Pipeline, Multi-User Runtime, RBAC, Audit Trail, Dashboard, Analytics, Distributed Runtime, Cluster Manager, Runtime Federation, High Availability, Disaster Recovery, + 17 Autonomous Architectures | Proposed |
| 0101 | [Autonomous Operations Runtime](RFC/0101_AUTONOMOUS_OPERATIONS_RUNTIME.md) — durable Task Inbox, Background Worker, Task Lease protocol, Privilege Broker, Approval Class policy engine, abstract Scheduler, Notification pipeline, Recovery semantics | Proposed |

## Why This Matters

These RFCs address real runtime failures:

- MiniMax auto-compacts but does not automatically resume.
- A model may stop because max output token limit is reached.
- Partial responses must be preserved and continued.
- The human needs mobile/tablet notifications.
- Headless servers cannot open interactive login windows for MiniMax usage console.
- The runtime must continue executing after the chat session ends, the SSH session disconnects, or the provider quota exhausts.
