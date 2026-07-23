# RFC-0101 — Autonomous Operations Runtime

## Status

Proposed

## Summary

`pi-harness-runtime` must continue executing work after the active chat session ends, the SSH session disconnects, the browser closes, the worker crashes, the host reboots, or the provider quota exhausts. RFC-0101 defines the subsystem that makes that possible.

It introduces a durable **Task Inbox**, a supervised **Background Worker**, a **Task Lease** protocol that guarantees single-execution under crash recovery, a **Privilege Broker** that replaces unrestricted `sudo` with capability-based commands, an **Approval Class** policy engine, an abstract **Scheduler** that compiles to `systemd` / `launchd` / `cron` / internal, a **Notification** pipeline that extends RFC-0022, and durable **Recovery** semantics integrated with RFC-0019 (Auto Compact and Continue), RFC-0020 (Output Token Limit Handler), and RFC-0021 (Partial Response Recovery).

This RFC integrates with (does **not** redesign):

| Existing RFC | Reused Component |
|---|---|
| RFC-0001 | Loop Runtime |
| RFC-0006 | Checkpoint Manager |
| RFC-0011 | Shared Blackboard |
| RFC-0015 | Job State Machine |
| RFC-0016 | Task Graph |
| RFC-0017 | Master Planner |
| RFC-0018 | Repair Engine |
| RFC-0022 | Notification Center |
| RFC-0008 | Provider Router |
| RFC-0003 | Quota Manager |
| RFC-0010 | Context Window Manager |
| OKF | Knowledge Engine |

## Motivation

Today, the harness requires an interactive `pi` session to keep a job alive. When the user closes the terminal, the assistant turn ends, no further tasks run, and queued work sits idle until they return. The runtime cannot:

- Resume a long job after the user is offline for hours or days.
- Run a recurring maintenance task (cleanup, restart-on-failure, quota refresh) without a chat session.
- Survive a worker crash without losing the in-flight task.
- Perform privileged operations safely — the only current options are "ask the user to type a password" or "ship a wide-open `NOPASSWD` sudo file," both of which are unacceptable in a production runtime intended for years of autonomous operation.

RFC-0101 fixes these gaps with a strictly-scoped, capability-based, recoverable runtime extension.

## Non-Goals

- Multi-tenant cloud orchestration. (Tracked separately under RFC-019 §Future.)
- Distributed consensus across hosts. (Tracked separately.)
- Replacing RFC-0015 (Job State Machine). RFC-0101 produces `Task` records that RFC-0015 transitions through its lifecycle.
- Replacing RFC-0011 (Shared Blackboard). RFC-0101's Task Inbox writes to blackboard during planning, then promotes to its own durable store once `claimed`.
- Long-lived interactive chat sessions. The runtime may run **alongside** chat, but the worker process does not depend on it.

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          User / Operator Dashboard                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │ HTTP / CLI
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Master Planner (RFC-0017)                          │
│  requirement ──▶ TaskGraph ──▶ Promotion to Task Inbox                        │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Task Inbox (structured queue)                        │
│  queued/ claimed/ running/ waiting_approval/ waiting_quota/ retrying/         │
│  completed/ failed/ dead_letter                                                │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Background Worker (long-lived)                       │
│  claim ──▶ execute ──▶ checkpoint ──▶ evaluate ──▶ complete|repair|escalate  │
└──────────────────────────────────────────────────────────────────────────────┘
       │           │            │             │            │
       ▼           ▼            ▼             ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌────────────┐
│ Task     │ │ Loop     │ │ Checkpoint   │ │ Repair   │ │ Notification│
│ Lease    │ │ Runtime  │ │ Manager      │ │ Engine   │ │ Center      │
│          │ │ RFC-0001 │ │ RFC-0006     │ │ RFC-0018 │ │ RFC-0022    │
└──────────┘ └──────────┘ └──────────────┘ └──────────┘ └────────────┘
                                     │
                                     ▼
                          ┌──────────────────────────┐
                          │   Privilege Broker       │
                          │   (capability-gated)     │
                          └──────────────────────────┘
                                     │
                                     ▼
                          ┌──────────────────────────┐
                          │   Scheduler Adapter      │
                          │   systemd / launchd /    │
                          │   cron / internal        │
                          └──────────────────────────┘
                                     │
                                     ▼
                          ┌──────────────────────────┐
                          │   OKF Knowledge Engine   │
                          │   (lessons + patterns)   │
                          └──────────────────────────┘
```

The worker does not require an interactive chat session. It can run under `systemd` (Linux), `launchd` (macOS), inside a Docker container, or as a plain process supervised by an init script.

## Component Responsibilities

| Component | Responsibility | Owns |
|---|---|---|
| **Task Inbox** | Durable queue of work waiting to be executed | `~/.pi/harness/inbox/tasks.jsonl` |
| **Task Lease** | Single-execution guarantee via heartbeat + timeout | Lease records in inbox |
| **Background Worker** | Long-lived process that claims tasks and drives them to completion | Worker state file |
| **Privilege Broker** | Maps capability names to fixed privileged commands | Capability registry |
| **Policy Engine (RFC-0028)** | Decides approval class per operation | In-policy decisions |
| **Scheduler** | Triggers recurring task templates at fixed schedules | Schedule table |
| **Notification Center (RFC-0022)** | Reports task lifecycle events to humans | Channel adapters |
| **Checkpoint Manager (RFC-0006)** | Persists task progress for crash recovery | Job checkpoints |
| **OKF Knowledge Engine** | Promotes completed/failed patterns into durable knowledge | OKF bundles |
| **Repair Engine (RFC-0018)** | Generates repair tasks on failure | Repair queue |

## 1. Architecture Overview

The runtime accepts **two classes of input**:

1. **Interactive task** — an explicit message from the user: "Build a REST API with JWT auth."
2. **Queued task** — an item previously written to the inbox (by a previous session, a webhook, a scheduled trigger, or a subagent).

Both flow through the **Task Inbox** and are processed by the **Background Worker** identically — the runtime does not differentiate the source after acceptance.

The **Privilege Broker** sits between the worker and the OS. The worker never makes raw `sudo` calls; it requests a named capability, the broker checks the policy, the broker invokes a fixed command under a service account, and the broker logs the call. This is the only path to root-equivalent operations.

The **Notification Center** (RFC-0022) is the *only* outbound channel to humans during a session-less run. The worker does not assume the user is at a terminal.

---

## 2. Task Inbox

The inbox is a structured, append-only store. **Markdown backlog files are not the database** — they may exist for human convenience but are generated from the inbox.

### Storage Layout

```
~/.pi/harness/
├── inbox/
│   ├── tasks.jsonl              # append-only durable store
│   ├── claimed/                 # active leases (json file per task)
│   │   └── <task-id>.lease.json
│   ├── completed/               # archived after retention window
│   │   └── <task-id>.json
│   ├── failed/
│   │   └── <task-id>.json
│   └── dead-letter/
│       └── <task-id>.json
├── schedules/
│   └── schedules.json           # Scheduler table
├── inbox.lock                   # flock file for inter-process safety
└── inbox.md                     # human-readable view (generated)
```

### Task Record

```ts
interface TaskRecord {
  id: string;                              // e.g. "task-2026-07-23-001"
  objective: string;                       // natural-language goal
  acceptanceCriteria: string[];            // list of verifiable outcomes
  source:
    | { kind: "chat"; userId: string }
    | { kind: "schedule"; scheduleId: string }
    | { kind: "webhook"; url: string }
    | { kind: "subagent"; parentTaskId: string }
    | { kind: "manual"; createdBy: string };

  priority: 0 | 1 | 2 | 3 | 4;            // P0..P4 (RFC-0015 convention)
  capabilities: CapabilityName[];          // capabilities the task may need
  approvalClass: ApprovalClass;            // initial class (may escalate)
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;                     // default 3
  context?: ExecutionContext;              // planner-provided inputs
  createdAt: string;                       // ISO 8601
  updatedAt: string;
  leaseId?: string;
  result?: TaskResult;
  failureReason?: string;
  history: TaskEvent[];
}

type TaskStatus =
  | "queued"
  | "claimed"
  | "running"
  | "waiting_approval"
  | "waiting_quota"
  | "retrying"
  | "completed"
  | "failed"
  | "dead_letter";

type TaskEvent = {
  ts: string;
  kind: "claimed" | "started" | "checkpointed" | "progress"
      | "blocked" | "approval_requested" | "approved" | "denied"
      | "failed" | "completed" | "recovered" | "dead_lettered";
  payload?: Record<string, unknown>;
};
```

### Promotion from Backlog

Markdown files such as `BACKLOG.md` may exist as a human-friendly authoring surface. On save, a hook promotes each `- [ ]` line to a `TaskRecord` and writes it to `tasks.jsonl`. The runtime never reads from Markdown as the source of truth.

---

## 3. Worker Lifecycle

The worker is a single-purpose process. It runs forever, restarting after a crash via its supervisor (`systemd`, `launchd`, Docker restart policy, or a simple init script).

### Lifecycle Phases

```
STARTUP
  └─▶ Recover orphan leases (see §4)
  └─▶ Reload active schedules from schedules.json
  └─▶ Register worker identity in worker-registry.json

RUNNING (steady state)
  └─▶ Loop:
        1. Refresh quota snapshot (RFC-0003)
        2. Drain approval queue (RFC-0028)
        3. Acquire next ready task (oldest-first by priority then createdAt)
        4. Begin lease (§4)
        5. Execute in Loop Runtime (RFC-0001)
        6. Stream progress events
        7. On exit → finalize lease, classify outcome
        8. Notify (RFC-0022)

SHUTDOWN (SIGTERM)
  └─▶ Finish in-flight task or release lease cleanly
  └─▶ Persist last-known checkpoint
  └─▶ Deregister from worker-registry
  └─▶ Exit 0
```

### Heartbeat and Liveness

The worker emits a heartbeat every 5 seconds to `worker-registry.json`. A **reaper** (run by any peer worker, or a separate cron-initiated script) scans the registry and revokes leases whose `expiresAt` is in the past (see §4).

### Multi-Worker Safety

Multiple workers may run concurrently for throughput. The Task Lease (§4) prevents double-execution. Workers on the same host coordinate via the `inbox.lock` flock file. Workers on different hosts require a network-shared filesystem or a future DB-backed inbox (out of scope for this RFC).

---

## 4. Task Leasing

### Lease Record

```ts
interface TaskLease {
  taskId: string;
  workerId: string;                  // uuid generated per worker startup
  acquiredAt: string;                // ISO 8601
  expiresAt: string;                 // acquiredAt + leaseTTL
  heartbeatAt: string;
  attempt: number;
}

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;          // 5 min
const HEARTBEAT_INTERVAL_MS = 30 * 1000;             // 30 sec
```

### Claiming

```
CLAIM(taskId, workerId):
  record = load(taskId)
  if record.leaseId and lease.expiresAt > now:
      reject: another worker holds the lease
  newLease = { taskId, workerId, expiresAt: now + 5min }
  atomic_write(claimed/<taskId>.lease.json, newLease)
  update(record.leaseId = newLease.id; status = "claimed")
  return newLease
```

Atomicity is provided by `write-tmp-then-rename` on POSIX file systems.

### Heartbeat

Every 30 seconds the worker extends its active lease:

```
HEARTBEAT(leaseId):
  lease = load(lease)
  if lease.workerId != self: abort — someone else now owns it
  lease.expiresAt = now + 5min
  lease.heartbeatAt = now
  save(lease)
```

### Recovery

A reaper (cron or peer-worker loop) reaps expired leases:

```
REAP():
  for lease in claimed/*.lease.json:
      if lease.expiresAt < now - grace(30s):
          task = lookup(lease.taskId)
          task.history.push({ kind: "recovered", payload: { from: lease.workerId } })
          task.status = "queued"             // back to queue
          task.attempts += 1
          delete claimed/<taskId>.lease.json
          notify("task-recovered", task)
```

A `grace` window of 30 s avoids recovering a worker that is alive but slow to heartbeat.

---

## 5. Background Execution

The runtime must run when no interactive session exists. The worker is therefore supervised by an init system — not by `pi`.

### Comparison of Supervisors

| Supervisor | Pros | Cons | Use case |
|---|---|---|---|
| `systemd` | First-class restart, watchdog timers, journal logging, drop-in units | Linux-only | Linux servers, cloud VMs |
| `launchd` | Built into macOS, plist format, KeepAlive | macOS-only | macOS dev hosts |
| Docker | Portable, restart policy, isolated filesystem | Container overhead | CI, staging, ephemeral environments |
| Plain process + shell `while true` loop | Zero dependencies, works anywhere | No watchdog (you must implement heartbeat-restart) | Local dev only |

### Selected Strategy

- **Production / staging:** `systemd` unit + `systemd` timer for recurring tasks (Linux).
- **Developer host (macOS):** `launchd` plist (KeepAlive, RunAtLoad).
- **CI / sandbox:** Docker with `restart: unless-stopped`.

The runtime provides drop-in unit templates under `packages/autonomous-runtime/units/`. The installer writes them into `/etc/systemd/system/` or `~/Library/LaunchAgents/` based on the host OS.

### Why Not "Background Pi Session"?

The original proposal suggested "ask pi to keep working in the background." This is **rejected** because:

1. Pi's lifecycle depends on an interactive session; chat-end tears down the runtime.
2. Pi does not survive `SIGHUP`, reboots, or quota exhaustion with a guaranteed checkpoint.
3. Pi does not provide capability-based privilege isolation.
4. Recurring tasks belong in a scheduler, not a chat loop.

---

## 6. Scheduler

The scheduler is an abstraction layer that compiles `ScheduledTask` records into native schedules.

### Scheduled Task Model

```ts
interface ScheduledTask {
  id: string;
  taskTemplate: Omit<TaskRecord, "id" | "createdAt" | "updatedAt" | "status" | "history">;
  schedule: string;                              // cron expression
  enabled: boolean;
  concurrencyPolicy: "forbid" | "replace" | "allow";
  timezone?: string;                             // default host tz
}

const EXAMPLES: ScheduledTask[] = [
  {
    id: "sched-healthcheck-5min",
    taskTemplate: {
      objective: "Health-check the worker",
      acceptanceCriteria: ["worker-registry.json refreshed", "last-heartbeat < 60s ago"],
      capabilities: [],
      approvalClass: "automatic_read_only",
      priority: 3,
      maxAttempts: 3,
      source: { kind: "schedule", scheduleId: "sched-healthcheck-5min" },
    },
    schedule: "*/5 * * * *",
    enabled: true,
    concurrencyPolicy: "forbid",
  },
];
```

### Adapters

| Adapter | Compilation Target |
|---|---|
| `systemd` | `.timer` + `.service` unit pair |
| `launchd` | `StartCalendarInterval` plist |
| `cron` | crontab fragment per task |
| `internal` | An in-process timer (dev/test only) |

The adapter is selected at install time based on host capabilities. Recompilation is idempotent — re-running `runtime install` does not duplicate units.

---

## 7. Privilege Broker

The broker is the **only** path to privileged operations. It is **not** a `sudo` replacement; it is a policy-gated dispatcher that maps capability names to fixed commands executed by a service account.

### Rejected Alternatives

RFC-0101 explicitly **rejects**:

- A `NOPASSWD` sudoers drop-in file listing `systemctl *`, `docker *`, `journalctl *`. Sudoers wildcards (`*`) match arbitrary arguments and are a privilege-escalation surface. For example, `systemctl status *` allows `status /etc/shadow`-style probes.
- A generic `shell.root` capability.
- Letting the agent pass arbitrary command lines.

### Request Flow

```
Worker
  └─▶ requestCapability("service.restart_your_app")
        │
        ▼
  Policy Engine (RFC-0028) ── Approval Class ──▶ grant | reject | escalate
        │
        ▼ (on grant)
  Broker
  └─▶ lookup("service.restart_your_app")
        │
        ▼
  execve({ "/usr/bin/systemctl", "restart", "your-app.service" })   // exact argv
        │
        ▼
  Audit Log (append-only JSONL)
  └─▶ record(capability, argv, exitCode, ts, workerId)
```

### Capability Names (initial set)

```ts
export type CapabilityName =
  // Read-only (automatic)
  | "service.read_status"
  | "logs.read_runtime"
  | "disk.inspect"
  | "network.inspect"
  | "process.list"

  // Reversible writes (automatic, audited)
  | "service.restart_runtime"
  | "service.reload_runtime"

  // Approval required
  | "package.install"
  | "package.remove"
  | "firewall.modify"
  | "sudoers.modify"
  | "migration.run"

  // Forbidden by default
  // (no `shell.root`, no `*` capabilities, no `docker.exec` etc.)
  ;
```

### Capability-to-Command Registry

The registry is a versioned file (`config/privileges.yaml`) that lives in source control and is reviewed like code:

```yaml
capabilities:
  service.restart_your_app:
    argv: ["/usr/bin/systemctl", "restart", "your-app.service"]
    user: your_app   # service account, not root
    description: "Restart the production runtime service"
    approvalClass: automatic_reversible

  disk.inspect:
    argv: ["/usr/bin/df", "-h"]
    user: your_app
    description: "Show filesystem usage"
    approvalClass: automatic_read_only

  package.install:
    argv: ["/usr/bin/apt-get", "install", "--yes", "{package}"]
    user: root
    description: "Install an OS package"
    approvalClass: human_approval_required
    argTemplate: { package: "<whitelisted name>" }
```

No regex. No wildcards. The `argv` is the exact, statically-known program.

### Audit Trail

Every broker call writes a line:

```json
{
  "ts": "2026-07-23T10:00:01Z",
  "workerId": "uuid-...",
  "taskId": "task-2026-07-23-001",
  "capability": "service.restart_your_app",
  "argv": ["/usr/bin/systemctl", "restart", "your-app.service"],
  "exitCode": 0,
  "stdoutSnippet": "...",
  "stderrSnippet": "..."
}
```

Appended to `~/.pi/harness/audit.log`. Rotated daily.

---

## 8. Capability Model

Capabilities are **closed**, **versioned**, and **approved by review**. New capabilities are added by:

1. PR that adds the capability entry to `config/privileges.yaml` with the exact `argv` and `approvalClass`.
2. Code review (human) + privileged-operation review (security).
3. Version bump on the registry. Workers reject unknown capabilities.

There is no "wildcard" capability. There is no "execute arbitrary command" capability. There is no "sudo" capability. Any attempt to add one is rejected in review.

---

## 9. Approval Policy

### Approval Classes

```ts
type ApprovalClass =
  | "automatic_read_only"            // read-only, idempotent, no side effects
  | "automatic_reversible"           // mutating but trivially reversible (restart, reload)
  | "human_approval_required"        // blocking — wait for human
  | "forbidden";                     // static reject at policy time
```

### Class Assignment per Operation

| Operation | Class |
|---|---|
| Read service status | `automatic_read_only` |
| Tail runtime logs | `automatic_read_only` |
| Write to `~/.pi/harness/` | `automatic_read_only` (user-owned) |
| Restart `your-app.service` | `automatic_reversible` |
| Reload nginx | `automatic_reversible` |
| Install OS package | `human_approval_required` |
| Modify `/etc/sudoers.d/` | `human_approval_required` |
| Drop database table | `human_approval_required` |
| Run migration on production | `human_approval_required` |
| Execute arbitrary shell | `forbidden` |
| Wipe `/var/lib/your_app` | `forbidden` (by default) |

### Approval Flow

```
Task needs capability X
  └─▶ policy.class(X) = human_approval_required
        │
        ▼
  Task status → waiting_approval
  ApprovalRequest published (RFC-0018 + RFC-0022)
        │
        ├─▶ approved by human → resume task, status → running
        │
        └─▶ denied by human → task status → failed (reason: "approval denied")
        │
        └─▶ timeout (configurable, default 24h) → task → failed (reason: "approval timeout")
```

Approvals are signed via the operator's existing SSH key and recorded in the audit log.

---

## 10. Notification Flow

Notifications extend **RFC-0022 (Notification Center)** with new event kinds:

```ts
type RuntimeNotificationEvent =
  // ... existing RFC-0022 events ...
  | "task.queued"
  | "task.claimed"
  | "task.completed"
  | "task.failed"
  | "task.waiting_approval"
  | "task.waiting_quota"
  | "task.recovered"             // lease expired, claimed by another worker
  | "task.dead_lettered"
  | "audit.privileged_called"    // human visibility on broker use
  | "worker.started"
  | "worker.crashed"
  | "worker.recovered";
```

Channels are unchanged (Telegram, LINE, Email, Webhook, ntfy). All security rules of RFC-0022 apply — no raw cookies, no tokens, no full source.

---

## 11. Recovery

The runtime must recover gracefully from:

| Failure | Recovery |
|---|---|
| Worker process killed / `OOMKilled` | Lease reaper releases the in-flight task; next worker claims it. |
| Host reboot | Supervised unit restarts worker; leases reaped on startup. |
| Power outage | Same as reboot, plus durable disk-journal recovery. |
| Quota exhausted (RFC-0003) | Task transitions to `waiting_quota`; resumes after reset. No retry storm. |
| Provider outage | Task waits in `waiting_quota` with jittered backoff; resumes when provider is healthy. |
| Task timeout (>30 min wall clock) | Checkpoint is preserved; task reaped and resumed from last checkpoint. |
| Network loss during checkout | Git shallow + retried; if persistent → task fails with reason. |
| Filesystem full | Tasks enter `waiting_disk`; broker refuses privileged writes; operator alerted. |
| Privilege broker denied | Task fails immediately with `reason: "broker denied: <capability>"`. |
| Approval denied | Task transitions to `failed (reason: "approval denied")`. |
| Repeated identical failure | After `maxAttempts` (default 3) the task is moved to `dead_letter/` and operator is notified. |

---

## 12. OKF Integration

The OKF Knowledge Engine is the runtime's durable long-term memory.

### What the Runtime Stores in OKF

| Event | Promoted As |
|---|---|
| Task completed successfully | A "pattern" bundle: inputs, approach, outputs, evidence pointers. |
| Task failed (after retries) | A "lesson" bundle: failure class, root cause, remediation. |
| Repair engine produced a fix | A "remediation" bundle: search → edit → verify trail. |
| New capability added | A "registry change" bundle: capability name, command, rationale. |

### Promotion Rules

1. A pattern is promoted only if the task had at least one human-visible deliverable (`TaskResult.kind === "deliverable"`).
2. A lesson is promoted only if the failure was classified (not a transient network blip).
3. All promotions include a content hash and source pointers — never raw secrets.

### Failure → Lesson Lifecycle

```
Task fails
  └─▶ Repair Engine classifies (RFC-0018)
        │
        ├─▶ transient → task retried (no OKF entry)
        │
        ├─▶ classified → lesson bundle written to OKF
        │
        └─▶ operator override → OKF entry marked "operator-fixed"
```

The Master's Planner (RFC-0017) reads OKF bundles during decomposition so successful patterns are reused and classified failures are avoided.

---

## 13. Task State Machine

```
                       ┌─────────┐
                       │ queued  │
                       └────┬────┘
                            │ claim
                            ▼
                       ┌─────────┐
        ┌───────────── │ claimed │ ─────────────┐
        │              └────┬────┘              │
   lease expired            │ begin             │ declined
        │                   ▼                   │
        │              ┌─────────┐              ▼
        │              │ running │         ┌─────────┐
        │              └────┬────┘         │ failed  │
        │     ┌─────┬───────┼───────┬────┐  └────┬────┘
        │     │     │       │       │    │       │
        │     ▼     ▼       ▼       ▼    ▼       ▼
        │  ┌──────┐ ┌────┐ ┌──────┐ ┌────┐ ┌──────┐
        │  │wait  │ │wait│ │retry │ │ done│ │dead  │
        │  │approv│ │quot│ │      │ │    │ │letter│
        │  └──┬───┘ └──┬─┘ └──┬───┘ └────┘ └──────┘
        │     │        │      │
        │     ▼        ▼      │ attempts < maxAttempts
        │  (human    (quota   │ → back to running
        │   resume)  reset)   │
        │     │        │      │
        └─────┴────────┴──────┘
```

### Transitions

| From | Event | To | Notes |
|---|---|---|---|
| queued | lease granted | claimed | Lease held |
| claimed | execution begins | running | Heartbeat starts |
| running | capability blocked | waiting_approval | Posted to approval center |
| running | quota exhausted | waiting_quota | No CPU burn while waiting |
| running | exception | retrying | attempts += 1 |
| retrying | retry timer fires | running | Backoff: 30 s × attempts |
| running | success | completed | Result persisted |
| running | attempts ≥ max | dead_letter | Operator notified |
| claimed | lease expired without heartbeat | queued | Reaper releases |
| waiting_approval | denied | failed | Reason recorded |
| waiting_approval | timeout (default 24h) | failed | Reason recorded |
| waiting_quota | quota reset | running | Resumes safely |

---

## 14. TypeScript Interfaces

The runtime is implemented in TypeScript and ships `types.ts` with the contract below.

```ts
// packages/autonomous-runtime/src/types.ts

export type CapabilityName = string;            // closed enum elsewhere

export type ApprovalClass =
  | "automatic_read_only"
  | "automatic_reversible"
  | "human_approval_required"
  | "forbidden";

export type TaskStatus =
  | "queued"
  | "claimed"
  | "running"
  | "waiting_approval"
  | "waiting_quota"
  | "retrying"
  | "completed"
  | "failed"
  | "dead_letter";

export interface TaskRecord { /* see §2 */ }

export interface TaskLease {
  taskId: string;
  workerId: string;
  acquiredAt: string;
  expiresAt: string;
  heartbeatAt: string;
  attempt: number;
}

export interface WorkerHeartbeat {
  workerId: string;
  startedAt: string;
  lastBeatAt: string;
  capacity: number;
  inflightTaskIds: string[];
}

export interface CapabilityGrant {
  name: CapabilityName;
  argv: string[];                    // exact, no shell
  envWhitelist?: string[];           // env vars that may be passed
  user: string;                      // service account
  cwd?: string;                      // chdir target if needed
  timeoutMs: number;
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  capability: CapabilityName;
  rationale: string;                 // human-readable
  signedBy?: { keyFingerprint: string; ts: string };
  decision?: "approved" | "denied";
  decidedAt?: string;
  expiresAt: string;
}

export interface ScheduledTask { /* see §6 */ }

export interface NotificationEvent {
  kind: RuntimeNotificationEvent;
  ts: string;
  taskId?: string;
  workerId?: string;
  payload: Record<string, unknown>;
}

export interface Checkpoint {
  taskId: string;
  attempt: number;
  state: Record<string, unknown>;
  savedAt: string;
}

export interface ExecutionContext {
  taskId: string;
  workerId: string;
  inputs: Record<string, unknown>;
  capabilitiesGranted: CapabilityName[];
  approvalClass: ApprovalClass;
  lease: TaskLease;
  checkpoint?: Checkpoint;
  okfBundles: string[];             // content hashes available to planner
}

export interface TaskResult {
  taskId: string;
  status: "completed" | "failed" | "dead_letter";
  deliverables?: { path: string; mime: string }[];
  acceptanceCriteriaMet: { criterion: string; passed: boolean; evidence?: string }[];
  durationMs: number;
  modelUsage?: { inputTokens: number; outputTokens: number; provider: string };
}
```

---

## 15. Folder Structure

```
packages/
├── autonomous-runtime/             # the worker + inbox + lease
│   ├── src/
│   │   ├── inbox.ts
│   │   ├── lease.ts
│   │   ├── worker.ts
│   │   ├── recovery.ts
│   │   ├── supervisor.ts           # systemd/launchd unit templates
│   │   └── types.ts
│   └── test/
│
├── privilege-broker/               # capability registry + executor
│   ├── src/
│   │   ├── registry.ts
│   │   ├── executor.ts
│   │   └── audit.ts
│   ├── config/privileges.yaml      # versioned, reviewed
│   └── test/
│
├── scheduler-adapter/              # cron/systemd/launchd/internal
│   ├── src/
│   │   ├── interface.ts
│   │   ├── systemd.ts
│   │   ├── launchd.ts
│   │   ├── cron.ts
│   │   └── internal.ts
│   └── test/
│
├── policy-engine/                  # RFC-0028 — promotes approval decisions
│   └── (existing)
│
├── notification-runtime/           # RFC-0022 — channel adapters
│   └── (existing)
│
└── okf-kb/                         # OKF integration (lesson/pattern promotion)
    └── (existing)
```

Drop-in unit templates installed by the runtime's installer:

```
packages/autonomous-runtime/units/
├── systemd/
│   ├── pi-runtime.service
│   └── pi-runtime.timer.example
├── launchd/
│   └── ai.moocoding.runtime.plist
└── cron/
    └── pi-runtime.cron.example
```

---

## 16. Security Considerations

| Concern | Mitigation |
|---|---|
| **Least privilege** | Capabilities are exact `argv`; no wildcards; service-account `user`, not root, by default. |
| **Audit trail** | Every broker call writes to append-only `audit.log`; rotated daily. |
| **Command injection** | Argv is structured, not a string; no shell interpolation. Arg templates (`{package}`) use a whitelist. |
| **Sandboxing** | The worker process runs as a dedicated service account with no shell login and limited `PATH`. |
| **Approval bypass** | Policy class is resolved at request time, not at registration. Re-resolution on each call. |
| **Privilege escalation** | No `sudo.any`, no `shell.root`, no wildcard capabilities. The broker cannot be reconfigured by the agent at runtime — only via reviewed PR. |
| **Replay attacks** | Approval requests carry a `signedBy` field and an `expiresAt`. Used approvals cannot be re-played. |
| **Tampering** | Audit log is append-only on a path owned by an account the worker cannot write to as a regular user. Use systemd `ReadWritePaths=` to confine. |
| **Secret exfiltration** | Notifications are redacted per RFC-0022. Approval rationale is redacted of secrets before display. |
| **Resource exhaustion** | Worker has `MemoryMax=` and `CPUQuota=` set in `systemd` unit; queue depth and disk usage are monitored and throttle new claims. |
| **TOCTOU on leases** | Lease claims use atomic `write-tmp + rename`. The lease file is the single source of truth for ownership. |

---

## 17. Failure Scenarios

Twenty realistic failure modes, each with its recovery strategy:

1. **Worker killed mid-task.** Lease reaper releases; new worker resumes from checkpoint.
2. **Host rebooted during a long task.** `systemd` restarts worker; lease reaper cleans up; checkpoint restored.
3. **Filesystem full during checkpoint write.** Worker pauses new claims; operator alerted via RFC-0022; cleanup job runs.
4. **Quota reset claim races worker claim.** Worst case the task starts immediately, hits quota again, transitions to `waiting_quota`. Idempotent.
5. **Provider returns 5xx for 30 minutes.** Tasks transition to `waiting_quota`; resumes on health probe green.
6. **Same task claimed twice due to clock skew.** Atomic rename protects; the second `write` overwrites with same content harmlessly; second worker sees `workerId != self` on next heartbeat and abandons.
7. **`auto-update` of provider library breaks checkpoint compatibility.** RFC-0006 schema validation refuses to load incompatible checkpoint; task restarts from `queued`.
8. **Operator deletes checkpoint mid-run.** Task fails; user is told "checkpoint missing — starting over."
9. **Out-of-date schedule triggers old task template version.** Scheduler is versioned; old templates continue to fire until explicitly deleted.
10. **Privilege registry file corrupted.** Worker refuses to start; operator gets a clear "registry invalid" error pointing at the schema validator.
11. **Untrusted input in capability arguments.** Argv templates use whitelist; unknown arg → broker reject → task fails safely.
12. **Approval request lost in transit.** Operator sees no notification; task expires after 24 h; broker logs the lost request.
13. **Worker writes to audit log but disk is read-only.** Worker switches to "degraded mode" (read-only); operator alerted; jobs paused.
14. **Recursive task creation (subagent spawns parent).** DAG-level cycle detection in RFC-0016 prevents new edges; runtime rejects parent IDs already in the active graph.
15. **Repair loop generates a circular repair.** Repair Engine (RFC-0018) caps attempts; infinite-loop repair fails task and moves it to dead-letter.
16. **OKF bundle write races read from planner.** OKF uses content hash + immutable append; planner sees either old or new, never partial.
17. **Network loss to notification channel.** Worker does not block on notification delivery; events buffered; flushed on reconnect.
18. **Clock jumps backward (NTP correction).** Lease expiry evaluated against `monotonic clock` where possible; otherwise a backward jump extends lease safety.
19. **Two operators race-approve.** First-write-wins on the approval; second operator sees "already approved" + audit entry.
20. **Power loss during atomic rename.** POSIX `rename(2)` is atomic; partial writes cannot leave a half-renamed file.

---

## 18. Sequence Diagrams

### A. New Task

```
User           Planner         Inbox          Worker          Loop Runtime
 │ ──chat──▶     │               │               │               │
 │               │ decompose     │               │               │
 │               │ ──────Task──▶ │               │               │
 │               │               │ append        │               │
 │               │               │ tasks.jsonl   │               │
 │               │ ◀────ok───── │               │               │
 │ ◀─ ack ──     │               │               │               │
 │               │               │   claim       │               │
 │               │               │ ◀──────────── │               │
 │               │               │               │ execute       │
 │               │               │               │ ────────▶     │
 │               │               │               │   progress    │
 │               │               │               │ ◀──────────── │
 │               │               │               │ ───done──▶    │
 │               │               │  result       │               │
 │               │               │ ◀──────────── │               │
 │               │               │               │ notify        │
 │               │               │               │ ─────▶RFC-0022│
```

### B. Worker Crash + Lease Reaper

```
Worker-A         Inbox          Reaper         Worker-B
  │ claim        │              │               │
  │ ─────▶       │              │               │
  │   (lease)    │              │               │
  │ execute ● KILLED             │               │
  ▼              ▼              │               │
  heartbeat stops                │ scan          │
  ▼              ▼              │ ◀─── claimed/  │
                                 │ expire? yes   │
                                 │ release ─▶    │
                                 │ tasks.jsonl   │
                                 │               │ claim
                                 │               │ ◀────▶
                                 │               │ resume from last
                                 │               │        checkpoint
```

### C. Approval Flow

```
Task             Policy         Broker          Approval Center        Operator
 │ capability    │              │                │                       │
 │ request ─▶    │              │                │                       │
 │               │ class =      │                │                       │
 │               │ human_needed │                │                       │
 │ ◀─ waiting   │              │                │                       │
 │ ──────────────── publish approval request ────▶│                       │
 │                │              │                │                       │
 │                │              │                │ ──notify────────────▶ │
 │                │              │                │                       │
 │                │              │                │ ◀──── approve ───── │
 │                │              │                │                       │
 │ ◀────────── approval granted ──────────────── │                       │
 │ resume ─▶     │              │                │                       │
 │               │ ─────broker.execute()────────▶│                       │
 │               │              │                │                       │
 │               │              │ audit.log      │                       │
```

### D. Recurring Task

```
Scheduler         Inbox           Worker          Loop Runtime
 │ tick (cron)    │               │               │
 │ template id    │               │               │
 │ materialise    │               │               │
 │ TaskRecord     │               │               │
 │ ───────────▶   │               │               │
 │  (tasks.jsonl) │               │               │
 │                │               │ claim         │
 │                │ ─────────────▶│               │
 │                │               │ execute       │
 │                │               │ ────────────▶ │
 │                │               │   result      │
 │                │ ◀────────────│               │
 │                │               │               │
 │ next-tick fires next materialise               │
```

### E. Notification Fan-Out

```
Worker         Event Bus        Telegram    LINE    Email    Webhook
 │ task.done    │                 │          │        │        │
 │ ────────▶   │                 │          │        │        │
 │             │ fan-out          │          │        │        │
 │             │ ────────────▶   │          │        │        │
 │             │ ──────────────────────▶    │        │        │
 │             │ ───────────────────────────▶         │        │
 │             │ ───────────────────────────────────▶          │
 │             │ (any failure: buffer + retry)               │
```

---

## 19. Future Extensions

| Extension | Trigger | Notes |
|---|---|---|
| Distributed workers across hosts | Need for horizontal scale | Requires shared inbox filesystem or DB-backed inbox (e.g., Postgres). Lease semantics unchanged. |
| Kubernetes operator | Need for elastic scale | Worker becomes a `Deployment`; lease uses `Lease` CRD. |
| Remote executors (cloud workers) | Heavy compute on user device is infeasible | Worker can ship a "task fragment" to a remote executor and await the result. Privilege broker does not extend to remote. |
| Hybrid local/cloud execution | Cost + latency optimization | Policy decides which tasks run local vs cloud. Tasks with `capability: package.install` must stay local. |
| Multi-tenancy | Per-tenant isolation | Each tenant gets its own inbox directory; broker routes to per-tenant service accounts. |
| Web UI for inbox + approvals | Operator UX | A static site reading the inbox over a thin HTTP API. |

These are tracked as separate RFCs when scoped; none of them block RFC-0101's MVP.

---

## 20. Acceptance Criteria

RFC-0101 is accepted when **all** of the following can be demonstrated:

### Functional

1. A task can be submitted while a chat session is open and run to completion after the session is closed.
2. A task can be scheduled and execute on its cron / timer schedule without any session.
3. The same task cannot be claimed by two workers concurrently (test with parallel workers on the same host).
4. If a worker is killed mid-task, the lease expires within `leaseTTL + grace`, and another worker resumes from the last checkpoint.
5. The privilege broker refuses any capability not in `config/privileges.yaml` (test with a synthetic capability name).
6. The privilege broker refuses any capability whose `argv` doesn't match the registered entry (test with arg tampering).
7. `human_approval_required` capabilities block the task and surface a notification; an `approved` decision resumes the task.
8. `forbidden` capabilities cause the task to fail immediately with a clear reason.
9. Provider quota exhaustion transitions the task to `waiting_quota` without burning CPU.
10. Quota reset transitions the task back to `running` automatically.
11. Notifications are sent per RFC-0022 rules — no secrets, no tokens, no full source.

### Operational

1. `pi-runtime` runs under `systemd` (Linux) / `launchd` (macOS) / Docker (any); restart policy verified.
2. Heartbeats are written to `worker-registry.json` every 30 seconds.
3. Reaper script (`packages/autonomous-runtime/scripts/reap-leases.ts`) reaps expired leases correctly under chaos test.
4. Audit log accumulates one entry per broker call; rotation is wired to `logrotate`.

### Recovery

1. Host reboot during a task: worker restarts; lease reaped; task resumes from checkpoint.
2. Filesystem full: worker pauses new claims; no checkpoint corruption.
3. Notification channel outage: events buffer; flush on reconnect; no event loss on `flush_after > channel_timeout`.

### Integration

1. Successful tasks with deliverables promote an OKF pattern bundle; promoted bundle readable by the Master Planner.
2. Failed tasks after retries promote a lesson bundle; planner reads it during decomposition and (where applicable) avoids the same failure class.

### Security

1. No capability contains a wildcard, a shell, or arbitrary `argv`.
2. The agent cannot trigger `privileges.yaml` mutation at runtime (no API exposed to the agent for this).
3. Audit log cannot be rewritten by the worker (filesystem permissions verified by test).

### Performance / Cost

1. Worker steady-state CPU < 1 % on idle (no busy loop).
2. Heartbeat write rate < 1 KB / 30 s.

---

## Open Questions

1. **Should the inbox support encryption-at-rest?** Recommended yes for multi-user hosts; deferred for MVP.
2. **Multi-host lease coordination** — NFS locks or a small lock service? Defer to RFC extension.
3. **What happens to the audit log size on a busy host?** Daily rotation + monthly archive; verified in §20.

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-23 | Markdown backlog is a view, not the source of truth | Markdown is hostile to atomic updates and concurrrent edits. |
| 2026-07-23 | Reject wide-open `NOPASSWD` sudoers | Wildcards in sudoers are a privilege-escalation vector. |
| 2026-07-23 | Use capability-based broker instead of `sudo` | Smaller blast radius, full auditability. |
| 2026-07-23 | Lease TTL default 5 minutes, heartbeat 30 seconds | Balances quick recovery vs no false reaps. |
| 2026-07-23 | Reaper grace 30 seconds | Tolerates slow heartbeats without losing leases. |
| 2026-07-23 | OKF promotion rules require human-visible deliverable | Avoids noisy patterns. |

## Related RFCs

- RFC-0001 Loop Runtime — invoked by worker
- RFC-0003 Quota Manager — drives `waiting_quota`
- RFC-0006 Checkpoint Manager — checkpoint storage
- RFC-0008 Provider Router — provider selection during retry
- RFC-0011 Shared Blackboard — operator-visible progress events
- RFC-0015 Job State Machine — handles job-level states
- RFC-0016 Task Graph — handles dependency DAG
- RFC-0017 Master Planner — initial decomposition
- RFC-0018 Repair Engine — generates repair tasks on failure
- RFC-0019 Auto Compact and Continue — context survival
- RFC-0020 Output Token Limit Handler — output truncation survival
- RFC-0022 Notification Center — channel adapters
- RFC-0028 Policy Engine — approval class resolution
