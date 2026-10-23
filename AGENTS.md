# Agent Instructions

## Terminology: Two Task Tracking Systems (CRITICAL)

This project has **TWO separate task trackers** with different purposes:

| Term | Tool | Purpose |
|------|------|---------|
| **bd** / **beads** / **issues** | `bd create`, `bd list`, `bd close` | Issue tracker synced with GitHub issues |
| **todo** / **todos** / **task list** | `todo` tool (JSON-RPC) | Local task list for in-session tracking |

**When in doubt, ASK**: If a user mentions "tasks", "todos", or "track this" without specifying, ask:

> **"Did you mean bd (issue tracker) or todo (local task list)?"**

### When to use each:
- **bd (beads)**: Long-lived issues, bugs, feature requests, GitHub-synced items
- **todo (local task list)**: Short-lived session tasks, step-by-step workflows, immediate action items

---

## Pre-Commit/Build Checklist

**BEFORE any `git commit`, `git push`, or `bench build`:**

1. Run `bd ready` to check for pending tasks
2. Check if any todo-list items are marked as done → **mark them complete** with `bd close <id>`
3. Ensure all pending tasks are tracked in bd before committing
4. If todos exist, acknowledge them in response before proceeding

```bash
# Check pending todos before commit
bd ready
bd list --status pending
```

**Why**: Agent often builds/commits without checking todos. This causes incomplete tasks to be forgotten.

## Staged Validation & Test-Cost Discipline (CRITICAL)

A task with a cheap tier and an expensive tier MUST use the cheap tier while the code is still changing. Repeating an expensive regression after every fix is the most common way an autonomous run burns an entire night.

1. **Declare the tiers.** Put the plan in the todo metadata (`metadata.validationPlan`):

   ```json
   {
     "metadata": {
       "validationPlan": {
         "fast": { "command": "bun test tests/fast", "expectedDurationMs": 18000, "datasetSize": 100 },
         "full": { "command": "bun test tests/full", "expectedDurationMs": 2400000, "datasetSize": 10000 },
         "budgetMinutes": 90,
         "finalTierRequired": true
       }
     }
   }
   ```

   The harness never guesses a tier from a command string. Without a declared plan the current behaviour is unchanged.

2. **Iterate on the fast tier.** After every code edit, rerun the fast tier plus the focused unit/type checks the edit touches.

3. **Run the full tier once.** Run the full tier as the final acceptance check, when the implementation and the fast tier are stable.

4. **Do not repeat the full tier blindly.** Never rerun the full tier after an edit that cannot affect the behavior it covers. If it genuinely must be repeated, say why in one line.

5. **Make the cost visible.** Report each validation run compactly: `[TEST] fast: bun test tests/fast - passed (18s, 100 records)`. A test that is not reported cannot be budgeted.

6. **No false completion.** A todo whose `finalTierRequired` plan is set must not be marked completed while that tier is pending or failed. Pause instead and report what passed, what is pending, and why.

7. **Respect the time budget.** `budgetMinutes` is a soft budget. When it is reached, stop at a safe boundary, report completed and skipped checks, and leave the work open. Never kill a destructive or non-interruptible test mid-run.

8. **The fast tier must be representative.** A small fixture keeps the shape of the data (optional fields, relations, uniqueness, boundary values, aggregates under test), not just the row count. Use deterministic data with cleanup so repeated runs do not accumulate rows.

9. **Record every tier run in the ledger.** The harness never runs the tests, so the run is recorded by whoever knows the result:

   ```bash
   bun scripts/validation-run.ts --item 12 --tier fast --status passed --duration 18s --dataset 100
   bun scripts/validation-run.ts --item 12 --tier full --status passed --duration 41m -- "bun test tests/full"
   ```

   The ledger is plain NDJSON under `~/.pi-harness-runtime/logs/validation-runs.jsonl` (inspectable with `tail` or `jq`) and every record is mirrored into the central logging pipeline. The harness reads it to know which tier already passed, so an unreported run looks like a run that never happened.

**What the harness does with the plan:**

- The continuation message carries the plan, the recorded tier state and the remaining budget, so the agent never re-runs a tier that already passed.
- When `budgetMinutes` is spent, the item pauses at a safe boundary: nothing is dispatched, the work stays open, and the reason is reported.
- When a todo with `finalTierRequired` is marked complete while that tier is pending or failed, the completion report is suppressed and the item is named instead. A todo may not be reported as done on the strength of an unreported run.

## Versioning Convention

**Only patch-level updates (`0.10.x`)** — no minor/major bumps until the app is fully functional.

When releasing:

```bash
bun scripts/release-all.ts --release-as patch   # default, use this
bun scripts/release-all.ts --release-as minor   # only if explicitly requested
bun scripts/release-all.ts --release-as major   # only if explicitly requested
```

## Release Tag Convention (CRITICAL)

**ALWAYS release a tag after ANY code change.** Use patch version bump (0.10.x → 0.10.x+1).

This repo uses tag-based GitHub Actions builds — no CI on push. Every code change should be tagged for release.

```bash
# After git push, immediately tag and push:
git tag v0.10.32 && git push origin v0.10.32

# Or use the release script:
bun scripts/release-all.ts --release-as patch
```

**Rule**: Every `git push` should be followed by a tag push. No code change should go unreleased.

## npm Publish Authentication

- **Normal release path: do NOT run local `npm publish`.** Push the code and release tag; GitHub Actions will sync/publish to npm.
- **GitHub Actions OIDC release path should not require `npm login`.**
- If a **local/manual npm publish fallback** is needed and `npm whoami` fails, ask the user to run:

  ```bash
  npm login
  ```

  before retrying the publish.
- Do not assume a previous local npm login is still valid.

## Context-Mode Tool Priority

Use tools in this order (highest to lowest priority):

1. **`ctx_batch_execute`** — Multiple commands with queries in one call
2. **`ctx_execute`** — Single command or data derivation
3. **`ctx_execute_file`** — Read/analyze file before editing
4. **`ctx_search`** — Query indexed knowledge base

**File operations**: Always use `ctx_execute_file` to read/analyze files before editing.

## File Copy Rule (Mimic/Clone Between Folders)

**When asked to mimic, clone, or copy code/files from one folder to another:**

1. **USE `cp` or `sudo cp`** instead of writing files from scratch
2. **Do NOT write files from scratch** — copying is faster, more accurate, and preserves exact code
3. **Use `sudo cp` when permissions require it** (different owners, protected directories)

```bash
# ✅ CORRECT - direct copy
cp /path/to/source/file.ts /path/to/dest/file.ts

# ✅ CORRECT - sudo for permission issues
sudo cp /path/to/source/file.ts /path/to/dest/file.ts

# ❌ WRONG - writing from scratch (loses fidelity, wastes time)
write /path/to/dest/file.ts
<content>
```

**Why**: Copying preserves exact code including comments, formatting, and subtle details. Writing from scratch introduces drift and incompleteness.

## NPM Package Build Issues (Important!)

### Bug: Missing `dist/` Directories in Packages

**Problem**: When `packages/*/dist/` is gitignored and a package has `.js` imports but no compiled output, the published npm package will crash pi on load with:

```
Cannot find module '../packages/notification/dist/notification-center.js'
```

**Root Cause**:

- The main build script (`bun run build`) only compiles packages with `tsconfig.json`
- If TypeScript is missing from `devDependencies`, `node_modules/.bin/tsc` doesn't exist
- The build loop silently ignores errors: `|| true`
- Packages get published WITHOUT their `dist/` directories
- Runtime imports from `dist/*.js` fail

**Solution**:

1. Ensure `typescript` is in `devDependencies` (so `tsc` is available)
2. Run `bun run build` locally BEFORE pushing
3. Verify `packages/*/dist/` contains compiled `.js` files
4. Commit the `dist/` output or ensure build succeeds in CI

```bash
# Check if dist exists before publishing
ls packages/notification/dist/

# If missing, build and check again
bun run build
ls packages/notification/dist/
```

**Prevention**: Add `typescript` to `devDependencies`:

```bash
bun add -d typescript
```

## Icon Usage

**This is a Node.js CLI daemon — do NOT add React as a dependency for icons.**

### Default: ASCII (no extra deps, keeps bundle small)

ASCII is the default choice for regular cases — it keeps the bundle small and works everywhere.

```typescript
// Stage indicators
[>>>] [==>] [###] [---] [OK!]

// Status icons
> write   ✓ review   ✗ blocked   ~ retry

// Compact flags (preferred for status lines)
[P] [W] [R] [F]  // plan/write/review/finish
```

**Never use emoji** — they render inconsistently across terminals and fonts, and CJK terminals display them at double width which breaks layout alignment.

### Nice/beautiful icons: Lucide (SVG, no React)

Use `lucide` only when you need polished SVG icons for display in a UI (not terminal output).

```typescript
import { FileCode, CheckCircle, XCircle, AlertTriangle } from 'lucide';

// Render to SVG string (no React, no DOM)
const svg = FileCode({ size: 16, strokeWidth: 2 });
// svg is an HTML string like '<svg width="16" height="16" ...>...</svg>'
```

Or use `lucide-static` for pre-built SVG strings — no runtime import:

```typescript
// No React, just static SVG strings
const icon = await readFile('./node_modules/lucide-static/icons/file-code.svg', 'utf8');
```

**Never use `react-icons`** — it pulls in React as a dependency.

## Todo List Rule (CRITICAL)

**When you identify 2+ tasks, issues, or jobs — add ALL of them to the task list immediately.**

Do NOT just list them in text. Use the `todo` tool to create tracked tasks:

```bash
# Creating multiple tasks at once (use todo tool, NOT bd!)
todo create "Fix initialRemotionData not defined"
todo create "Fix dictionary.title undefined"
todo create "Replace Film icon with themed icon"
```

**Rule**: If you write something like:

- "There are 3 issues: ..."
- "I found several problems: ..."
- "Let me fix these: 1) X 2) Y 3) Z"
- "Here are the tasks to do: ..."

**Then you MUST create Todo items for each one.** Single-issue fixes don't need tracking.

**Why**: Agents often identify issues verbally but forget to track them. This rule ensures nothing slips through.

**IMPORTANT**: The `todo` tool and `bd` commands are DIFFERENT systems. Use `todo` for local task tracking.

---

### Habit: Detect New Tasks from User Prompts (CRITICAL)

**When a new user prompt arrives with tasks that differ from the current in-progress task — add ALL new tasks to the todo list immediately.**

**Trigger**: User prompt arrives while current task is not completed.

**Rule**:
1. Compare new prompt tasks vs current in-progress task
2. If they are different/unrelated tasks → call `todo create` for EACH new task BEFORE starting work
3. Do NOT start working on new tasks until they are tracked

**Why**: Agents often start working on new prompts immediately and forget to track them. This habit ensures nothing slips through.

**Example**:
```text
User: "Also, can you check the logs for errors?"
# Current task: Building auth feature (in_progress)
# New task: Check logs for errors (DIFFERENT task)
# → MUST call todo create "Check logs for errors" FIRST
```

**Tip**: You may assign this habit to Jev to consider this strictly. If another prompt comes in before the current task is done, Jev should flag that new tasks need to be added to the todo list.

## Remote Server Commands (SSH)

**ALWAYS use detached SSH pattern to prevent long hangs.**

### Anti-Pattern (blocks SSH, hangs ~2000s)

```bash
# WRONG - SSH blocks waiting for background process
ssh user@host "kill old; sleep 2; uvicorn ... &"
# SSH never returns because it waits for uvicorn
```

### Correct Pattern (fast exit, process stays on server)

```bash
# CORRECT - SSH exits fast, process continues on server
ssh -o BatchMode=yes user@host \
  "kill -9 917094 970065 2>/dev/null; sleep 1; \
   cd /home/user/amos-saas/backend/services/api && \
   nohup .venv/bin/uvicorn amos_api.main:app --host 0.0.0.0 --port 8100 \
   > /tmp/uvicorn.log 2>&1 & \
   echo 'UVICORN_STARTED'"
```

**Key changes:**

- `nohup ... &` — detaches from SSH session
- `> /tmp/uvicorn.log 2>&1` — captures output to file
- `echo 'UVICORN_STARTED'` — SSH exits fast with confirmation
- `-o BatchMode=yes` — non-interactive, fails fast on auth issues

**Why this matters**: A bare `&` in SSH keeps the shell open. `nohup` + redirect + `echo` ensures SSH exits immediately while the process runs on the server.

**For long-running commands**, add a timeout guard:

```bash
timeout 60s ssh -o BatchMode=yes user@host "long-command; echo DONE"
```

### Status files

The `.harness-status` file is consumed by the pi host, which adds its own UI. Keep daemon output plain ASCII:

```
# ✅ Good — plain ASCII with compact flags
[P] planning  |  MiniMax: 5h: 89% left
[W] coding    |  MiniMax: 5h: 89% left

# ❌ Bad — emoji in machine-readable files (CJK alignment issues)
🧭 planning  |  MiniMax: 5h: 89% left
✍️  coding   |  MiniMax: 5h: 89% left
```

---

## Default Habits

These habits are automatically enforced by the harness:

### 1. Policy Acknowledgment
On session start, if `[POLICY REQUIRED]` appears:
```
1. Run: harness_rules({ action: "manifest" })
2. Then run: harness_rules({ action: "acknowledge", revision: "..." })
```
This is a one-time step per session.

### 2. Pre-Commit Checklist
BEFORE any `git commit`, `git push`, or `bench build`:
1. Run `bd ready` to check for pending tasks
2. Mark completed todos with `bd close <id>`
3. Ensure all blockers are tracked in bd

### 3. Context-Mode Tool Priority
Use tools in this order (highest to lowest priority):
1. **`ctx_batch_execute`** — Multiple commands with queries in one call
2. **`ctx_execute`** — Single command or data derivation
3. **`ctx_execute_file`** — Read/analyze file before editing
4. **`ctx_search`** — Query indexed knowledge base

**File operations**: Always use `ctx_execute_file` to read/analyze files before editing.

### 4. Secret Management
- **Never hardcode secrets** in source code
- Store secrets in `~/.pi-harness-runtime/keys/`
- Use key file pattern: `~/.pi-harness-runtime/keys/<service>-api-key.txt`
- Reference keys via `key-loader.ts` helper

### 5. Document-Only Changes
- Wiki/documentation changes go in `wiki/` (gitignored)
- API keys, tokens, credentials: **never commit**

---

## React Best Practices (CRITICAL)

Agents MUST follow these React composition rules. Violations trigger warnings and require explicit override.

### 6. Component Size Limits

| Threshold | Action |
|-----------|--------|
| 0-150 lines | ✅ Green - No action needed |
| 150-300 lines | 🟡 Yellow - Consider extracting sub-components |
| 300+ lines | 🔴 Red - MUST extract before committing |

**Before writing any React component >150 lines, ALWAYS ask:**
- "Can I extract this into smaller, focused components?"
- "What are the logical sub-sections that could be their own component?"

### 7. Component Extraction Checklist

When a component exceeds 150 lines, extract the following into separate components:

- [ ] **Sub-section with distinct purpose** → Extract to `<SubComponent />`
- [ ] **Repeated JSX structure** → Extract to `<ListItem />` or `<Card />`
- [ ] **Complex stateful logic** → Extract to custom hook `useXxx()`
- [ ] **Large JSX block (>20 lines)** → Extract to `<RenderXxx />` or separate component
- [ ] **Props interface >5 props** → Consider compound components or children-as-function
- [ ] **Conditional rendering block** → Extract to `<XxxView />` or `<Show when={...} />`

### 8. Composition Patterns (Prefer These)

**GOOD - Compound Components:**
```tsx
<Dialog>
  <Dialog.Header>Title</Dialog.Header>
  <Dialog.Body>Content</Dialog.Body>
  <Dialog.Footer><Button>Close</Button></Dialog.Footer>
</Dialog>
```

**GOOD - Children as Content:**
```tsx
<Card>
  <Card.Header title="Info" />
  <Card.Body>Details here</Card.Body>
</Card>
```

**GOOD - Custom Hooks for Logic:**
```tsx
const { isLoading, error, data } = useDataFetch(url);
// NOT: all logic inline in component
```

**BAD - God Components:**
```tsx
// ❌ DON'T: Single file with 500+ lines
// ❌ DON'T: 15+ props on one component
// ❌ DON'T: Multiple unrelated state variables
// ❌ DON'T: Deeply nested conditional rendering
```

### 9. File Naming Convention

```
ComponentName/
├── index.tsx          # Main component (keep <150 lines)
├── ComponentName.tsx  # Re-export from index
├── SubComponent.tsx   # Extracted sub-components
├── useComponent.ts    # Custom hooks
├── types.ts           # TypeScript interfaces
└── ComponentName.test.tsx
```

### 10. Pre-Write Check

**BEFORE starting any React feature, plan the component structure:**

```
Feature: UserDashboard
├── components/
│   ├── UserDashboard/index.tsx      (entry, <100 lines)
│   ├── UserDashboard/StatsCard.tsx   (extracted)
│   ├── UserDashboard/UserList.tsx    (extracted)
│   └── UserDashboard/useUserData.ts  (custom hook)
```

**This prevents the "write big file, then extract" anti-pattern.**

---

## Dev PC vs Production Build Rules

### 11. When to Build vs Run Dev

**Dev PC (hot-reload available):**
```bash
# ✅ DO: Use bun run dev (hot reload, no build needed)
bun run dev

# ❌ DON'T: Run build unless specifically asked
# bun run build   # Wasteful - dev server compiles on-demand
```

**Why?**
- Hot-reload: Code changes reflect immediately
- RAM savings: No parallel build + dev consuming memory
- Speed: Faster iteration cycle

**When on Dev PC with limited RAM (16GB or less):**
- NEVER run both `build` AND `dev` simultaneously
- Only run `dev` - it compiles on-demand
- Explicitly asked to build only when needed

**Production/CI/Server:**
```bash
# ✅ DO: Build before running
bun run build
bun run start

# ✅ DO: Build in CI pipelines
bun run build && bun run test
```

### 12. RAM-Aware Command Decision

**Before running any command, consider:**

| Scenario | Action |
|----------|--------|
| Dev PC, any RAM | `bun run dev` only (no build) |
| Dev PC, 16GB RAM | Never run build + dev together |
| CI/Production | Always build first |
| Server deployment | Build, then run compiled |
| Explicit "build" request | Build as requested |

**Detection:**
- Check for `bun run dev` or `npm run dev` in package.json scripts
- If `dev` script exists, prefer it on Dev PC
- If no `dev` script, fall back to build

### 13. Quick Reference

```bash
# Dev PC (THIS IS THE DEFAULT for local development)
bun run dev        # ✅ Correct - hot reload, saves RAM

# Production/Server/CI
bun run build      # ✅ Correct - pre-compile
bun run start      # ✅ Correct - run compiled

# Explicit workflows
bun run build && bun run test    # CI pipeline
bun run build && bun run start   # Server deployment
```

### 14. Workspace Environment Auto-Detection

**At session start, the harness auto-detects:**
- `.env` / `.env.*` file variables → Dev environment evidence
- `package.json` `dev` script → Hot reload capability
- The environment variable, in this order: the `NODE_ENV` of the process env
  (it decides, also when it names no known mode), then the dotenv files of the
  workspace: `NODE_ENV`, an environment shaped key whose value names a known
  mode (`*_ENV`, `*_ENVIRONMENT`, `*_MODE`, `*_STAGE`, e.g. `AMOS_ENV`), then
  any other environment shaped key - and only then an environment shaped key
  of the process env → development/production/test
- The facts about the repository (only when NO variable names the environment
  at all) → a published source repository without a runtime of its own is a
  development checkout; a `develop`/`development` branch is the fallback
- System RAM → Low RAM warning (<4GB free, or a small machine (<16GB total)
  with less than 6GB free). The warning is about the headroom that is
  actually free, not about the size of the machine: a 15GB laptop with 6.5GB
  free can build, a 32GB server with 3GB free cannot.
- Running processes → dev/build server status

The dotenv files are read from the WORKSPACE (not from the current working
directory), the template files (`.env.example`, `.env.sample`,
`.env.template`, ...) are ignored and a file bigger than 256 kB is not read.
A value that is not provably harmless is masked (`<set>`): only the
`NODE_ENV` of the process env and a value that IS the name of the mode are
shown. A key that only looks like a branch (`BRANCH=production`) never
decides the mode.

**Session variables of a desktop are not environment selectors.**
`GNOME_SHELL_SESSION_MODE`, `XDG_*`, `DESKTOP_*`, `DBUS_*`, ... name the
desktop session, never the environment of a workspace. Some of them end in
`_MODE` or `_ENV`, so they are excluded from the candidates by NAMESPACE,
not by value: their value ("ubuntu", "wayland") says nothing about the mode.

**The repository tier (last resort, never production).** It runs only when
no variable names the environment at all. A published package (a
`package.json` with a name, a version and declared content - `files`,
`bin` or `publishConfig`) without a deployment configuration (no Dockerfile,
compose file, Procfile, fly.toml, render.yaml, railway.json, vercel.json,
netlify.toml, serverless.yml, app.yaml, pm2 ecosystem file, no deploy
workflow) and without a running server is SOURCE CODE that the user runs on
their own machine → `DEVELOPMENT (source-only repository)`. A branch named
`develop` or `development` is the fallback → `DEVELOPMENT (git branch
develop)`. A production branch is NEVER a development checkout, and this
tier never claims production.

**This info is shown in UI and delivered to agent context:**
```text
Workspace: ~/pi-harness-runtime | OS: Linux | mode: DEVELOPMENT (from AMOS_ENV in .env) | dev server: running | dev script: available | build script: available | RAM: 10/16
```

The mode words are exactly what the detector emits: `DEVELOPMENT`, `PRODUCTION`,
`TEST` or `UNKNOWN` (with its reason, e.g.
`UNKNOWN (no NODE_ENV or environment variable found)` or
`UNKNOWN (AMOS_ENV in .env names no known mode)`). A known mode also
names its source: `DEVELOPMENT (from AMOS_ENV in .env)` or
`DEVELOPMENT (source-only repository)`.
A dev/build script is a CAPABILITY, not a state: `dev script: available` means
the script exists, not that a server runs. The server state is separate and
never claims more than it knows: `running`, `not detected` (a check ran and
found nothing) or `not checked` (no check was possible, e.g. no `pgrep`).

The OS is part of the line because it decides which command prints the
working directory: `pwd` on Linux/macOS, `(pwd).Path` or `$pwd.Path` in
PowerShell (the plain `pwd` there prints a "Path: " header), `cd` or
`echo %cd%` in the Windows command prompt. The agent context names the
command to use.

**IMPORTANT Rules:**

| State | Action |
|-------|--------|
| `mode: UNKNOWN (…)` | Explicitly ask user before build |
| `mode: DEVELOPMENT` | Use `dev` mode, don't auto-build |
| `mode: PRODUCTION` | Build allowed, but confirm with user |
| `Low RAM` | Never run parallel build + dev |
| `Dev server running` | Reuse it, don't restart |

The status line states the build permission with its reason: `Build allowed:
yes`, `no - low memory` (not enough free memory) or `no - requires explicit
request` (the mode is unknown, so the environment has to be investigated
first). In development mode the permission follows the free memory (a build
needs ~2GB), not the size of the machine.

**Decision flow:**
```text
Check process.env.NODE_ENV first (it decides, also when it names no known mode)
Check the .env and .env.* files of the workspace second
  (NODE_ENV, then an environment shaped key whose value names a mode,
   then any other environment shaped key)
Only then an environment shaped key of the process env (e.g. AMOS_ENV)
Only then the facts about the repository
  (a published source repository without a runtime of its own,
   or a develop/development branch)
Presence of dev script = capability, not proof of mode
UNKNOWN requires investigation, not auto-build
Production detection ≠ deployment authorization
```


**SQLite stored at:**
```
~/.pi-harness-runtime/workspace-env.sqlite
```

## Centralized Application Logging

All application logs can be shipped to **Cloudflare R2** (durable archive) and to the
**unified webhook server** (live path). The pipeline lives in `packages/logging`
(`@pi-harness/logging`); the harness uses the process-wide singleton from it.

**Delivery order** (first success wins, the rest are skipped):

```text
producer -> redact -> sample -> buffer -> R2 -> webhook -> local spool (~/.pi-harness-runtime/logs/spool)
```

- The local spool is the fallback: if every transport fails the batch is written to
  disk as NDJSON and re-shipped on the next successful flush. Nothing is lost, only delayed.
- The local log files (`~/.pi-harness-runtime/logs/*.jsonl`, `harness/*.log`) stay the
  source of truth. The centralized pipeline is a copy for the archive.

**Configuration** (environment first, then `~/.pi-harness-runtime/keys/`):

| Variable | Meaning | Default |
|----------|---------|---------|
| `PI_LOG_SINK` | `off` \| `auto` \| `r2` \| `webhook` \| `r2+webhook` | `auto` |
| `PI_LOG_LEVEL` | Minimum level that is shipped | `info` |
| `PI_LOG_SAMPLE_RATE` | Share of `debug` records kept (0..1) | `0.1` |
| `PI_LOG_RATE_LIMIT` | Max records per source+event per minute | `60` |
| `PI_LOG_BATCH_SIZE` | Records per batch | `100` |
| `PI_LOG_BUFFER_SIZE` | Records held in memory | `1000` |
| `PI_LOG_FLUSH_INTERVAL_MS` | Automatic flush interval | `15000` |
| `PI_LOG_WEBHOOK_URL` | Ingest URL of the webhook server | unset |
| `PI_LOG_WEBHOOK_TOKEN` | Bearer token for the ingest endpoint | unset |
| `PI_LOG_R2_BUCKET` / `PI_LOG_R2_ENDPOINT` / `PI_LOG_R2_ACCESS_KEY_ID` / `PI_LOG_R2_SECRET_ACCESS_KEY` | R2 credentials | key files |
| `PI_LOG_SPOOL_DIR` | Local spool directory | `~/.pi-harness-runtime/logs/spool` |

R2 credentials are read from the key files `r2-bucket-name.txt`, `r2-endpoint.txt`,
`r2-access-key-id.txt`, `r2-secret-access-key.txt` and `r2-account-id.txt`.

**Rules for producers:**

- Emit through the singleton: `centralInfo/centralWarn/centralError(source, event, message?, fields?)`.
  The `source` identifies the component, the `event` is a dotted name.
- Redaction is automatic (key names, credential patterns, truncation), but producers must
  not pass user content: prompts, raw model output and message bodies are dropped by the
  redactor, so shipping them is pointless.
- Never put a credential in a log message. The redactor is a safety net, not a licence.
- The webhook server exposes `POST /api/logs` for the ingest path. Set `LOG_INGEST_TOKEN`
  to require a bearer token; the server re-redacts every batch and relays it to R2.
