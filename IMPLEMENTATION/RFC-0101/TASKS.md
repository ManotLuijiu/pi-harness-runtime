# Tasks — RFC-0101 Autonomous Operations Runtime

> Track per-package work. Sub-tasks may reference each other.

## Phase 1 — Foundations

- [x] Read RFC-0101 and confirm scope.
- [x] Define `TaskRecord`, `TaskLease`, `TaskEvent`, `CapabilityName`, `ApprovalClass`, `TaskStatus` types in `packages/autonomous-runtime/src/types.ts`.
- [x] Define JSON schemas for inbox and lease files (as JSDoc comments in types.ts).
- [x] Implement `TaskInbox.append`, `TaskInbox.list`, `TaskInbox.transition` against `tasks.jsonl`.
- [x] Implement atomic claim via `open(O_EXCL) + rename` to `claimed/<task>.lease.json`.
  - **Fix applied:** `rename(2)` atomically overwrites — switched to `open(O_CREAT|O_EXCL)` + `rename` so second worker gets `EEXIST`.
  - **Tests:** 23/23 pass including race condition test.

## Phase 2 — Lease and Worker

- [ ] Implement `Lease.claim(taskId, workerId)` — atomic, single-execution.
- [ ] Implement `Lease.heartbeat(leaseId)` — extends `expiresAt`.
- [ ] Implement `Lease.reap()` — releases expired leases back to `queued`.
- [ ] Implement `Worker.loop()` — claim → execute → checkpoint → finalize.
- [ ] Implement `Worker.recoverOnStartup()` — reaps orphan leases.
- [ ] Implement `Worker.emitHeartbeat()` — every 30 s.
- [ ] Add `worker-registry.json` rotation.

## Phase 3 — Privilege Broker

- [ ] Load `config/privileges.yaml` at worker startup; reject unknown capabilities.
- [ ] Implement `Broker.request(capabilityName, args)` — resolves to registered `argv`.
- [ ] Implement `Broker.execute(grant)` — uses `execve` (no shell) with service account.
- [ ] Implement `Broker.deny(unknown)` — explicit failure with reason.
- [ ] Append every call to `audit.log` with `{ts, workerId, taskId, capability, argv, exitCode}`.
- [ ] Add `logrotate` config for `audit.log`.

## Phase 4 — Policy + Approval

- [ ] Resolve `approvalClass(capability)` via RFC-0028 lookup.
- [ ] Implement `Approval.request(capability, rationale)` — write approval request.
- [ ] Implement `Approval.decide(id, decision, signedBy)` — updates request, audits.
- [ ] Implement `Approval.timeout()` — sweep expired approvals, fail tasks.
- [ ] Implement `Approval.notify()` via RFC-0022 channel adapters.

## Phase 5 — Scheduler Adapter

- [ ] Implement `SchedulerAdapter.interface.ts` — common API.
- [ ] Implement `systemd` adapter — write `.service` + `.timer` units from templates.
- [ ] Implement `launchd` adapter — write `plist` with `StartCalendarInterval`.
- [ ] Implement `cron` adapter — write crontab fragment.
- [ ] Implement `internal` adapter — for dev/test only, marks not-for-production.
- [ ] Make install-time selection idempotent — re-running install does not duplicate units.

## Phase 6 — Recovery

- [ ] Wire `worker-crash → reaper → resume from last checkpoint`.
- [ ] Wire `host-reboot → supervisor restart → worker startup recovery`.
- [ ] Wire `quota-exhausted → waiting_quota → resume on reset`.
- [ ] Wire `task-timeout → checkpoint preserved → reaped and resumed`.
- [ ] Wire `filesystem-full → worker paused claims → operator alert`.

## Phase 7 — OKF Integration

- [ ] Implement `OKF.promotePattern(task)` — only on `TaskResult.kind === "deliverable"`.
- [ ] Implement `OKF.promoteLesson(task)` — only on classified failure.
- [ ] Wire planner (RFC-0017) to read lesson / pattern bundles during decomposition.
- [ ] Document OKF promotion rules in `packages/okf-kb/`.

## Phase 8 — Tests

- [ ] Unit: inbox append/read, lease claim/heartbeat/reap.
- [ ] Unit: broker lookup, argv resolution, denial paths.
- [ ] Unit: policy class resolution per capability.
- [ ] Integration: parallel worker claim race.
- [ ] Integration: lease reaper recovery.
- [ ] Integration: broker denial paths.
- [ ] Integration: scheduler materialisation for each adapter.
- [ ] Failure-mode: killed worker, full disk, quota reset, expired approval, repeated failures.
- [ ] Security: argv tampering rejected; audit log rotation works; broker refuses unknown names.

## Phase 9 — Documentation

- [ ] Write `packages/autonomous-runtime/README.md`.
- [ ] Write `packages/privilege-broker/README.md` (incl. how to add a new capability).
- [ ] Write `packages/scheduler-adapter/README.md` (per-adapter install guide).
- [ ] Update root `README.md` with reference to RFC-0101.
- [ ] Update bundled `skills/harness-runtime/SKILL.md` with `/runtime` slash-command doc.

## Phase 10 — Acceptance

- [ ] All 25 acceptance criteria from RFC-0101 §20 demonstrated.
- [ ] Skill registry exposes `autonomous-runtime` skill on agent startup.
- [ ] Systemd unit survives `systemctl restart` chaos test.
- [ ] Audit log present after one broker call; rotated after 24 h.
- [ ] OKF pattern bundle produced by at least one happy-path task.
