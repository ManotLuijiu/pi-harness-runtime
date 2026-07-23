# AI Brief — Autonomous Operations Runtime (RFC-0101)

## Status

🟡 Proposed — awaiting implementation kickoff

## Goal

Implement the Autonomous Operations Runtime subsystem of `pi-harness-runtime` so that:

- Queued work runs without an active `pi` session.
- The runtime survives worker crashes, host reboots, quota exhaustion, and SSH / browser disconnect.
- Privileged operations are gated by a capability-based broker, never by raw `sudo`.
- Recovery, lease, and approval semantics are durable and observable.

## Implemented (when done)

- `packages/autonomous-runtime/` — Task Inbox, Lease, Worker, Recovery, Supervisor templates.
- `packages/privilege-broker/` — capability registry + executor + audit log.
- `packages/scheduler-adapter/` — `systemd` / `launchd` / `cron` / internal.
- `config/privileges.yaml` — versioned capability registry (closed enum).
- `units/systemd/pi-runtime.service`, `units/launchd/*.plist`, `units/cron/*.cron.example`.
- OKF promotion rules in `packages/okf-kb/` (reuses existing engine).

## Features

- Structured durable Task Inbox (`tasks.jsonl` + `claimed/` + `completed/` + `failed/` + `dead-letter/`).
- Single-execution guarantee via Task Lease (TTL 5 min, heartbeat 30 s, grace 30 s).
- Capability-based privilege broker with append-only audit log.
- Approval classes (`automatic_read_only`, `automatic_reversible`, `human_approval_required`, `forbidden`).
- Scheduler abstraction compiling to `systemd`, `launchd`, `cron`, or internal timer.
- Notification fan-out extended with autonomous-ops events (`task.recovered`, `audit.privileged_called`, etc.).
- Recovery from worker crash, host reboot, quota exhaustion, task timeout.
- OKF lesson / pattern promotion rules.

## Non-Goals

- Multi-host distributed lease coordination (deferred to future RFC).
- Multi-tenant isolation (deferred to future RFC).
- Replacing RFC-0015 (Job State Machine) or RFC-0011 (Shared Blackboard).

## Integration Points

| Existing | Reused As |
|---|---|
| RFC-0001 Loop Runtime | Inner execution loop |
| RFC-0003 Quota Manager | `waiting_quota` transitions |
| RFC-0006 Checkpoint Manager | Task-level checkpoint storage |
| RFC-0011 Shared Blackboard | Operator-visible progress events |
| RFC-0017 Master Planner | Task generation |
| RFC-0018 Repair Engine | Failure → repair task generation |
| RFC-0022 Notification Center | Channel adapters |
| RFC-0028 Policy Engine | Approval class resolution |

## Constraints

- **Public repository.** Sanitize client / server / product names. Use generic placeholders: `your_app`, `your-app.service`, `your-project`, `/opt/your_app`.
- **No wide-open `NOPASSWD`.** Sudoers is not acceptable as a privilege mechanism.
- **No `shell.root` capability.** The capability registry is closed and versioned.
- **Local-first.** No mandatory cloud dependency.
- **Recoverable.** Every transition is checkpointed; every lease has a TTL.

## Tests

Subagent-implemented:

- Unit: inbox append/read, lease atomic claim, heartbeat extension, broker execution, policy class resolution.
- Integration: parallel-worker claim races, lease reaper recovery, broker denial paths, scheduler materialisation for each adapter.
- Failure-mode: killed worker, full disk, quota reset, expired approval, repeated failures → dead letter.
- Security: capability enumeration refuses unknown names; argv-tampering rejected; audit log rotation works.

## Risks

- **Risk:** OS-specific supervisor templates break on non-target platforms. *Mitigation:* Adapter abstraction + matrix tests per adapter.
- **Risk:** Audit log grows unbounded. *Mitigation:* Daily rotation via `logrotate` + monthly archive.
- **Risk:** Operator forgets to wire scheduler adapter. *Mitigation:* Installer detects host OS and writes the correct unit; warns if multiple supervisors detected.

## Definition of Done

RFC-0101 implementation is considered done when all 25 acceptance criteria in the RFC are demonstrably met (manual or automated test) and the README + skill docs reference the new packages.
