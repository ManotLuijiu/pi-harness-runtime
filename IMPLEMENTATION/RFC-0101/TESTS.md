# Test Plan — RFC-0101

## Unit Tests

### Inbox

- `inbox.append` writes one JSON line per call to `tasks.jsonl`.
- `inbox.list` returns queued tasks in stable order (priority → createdAt).
- `inbox.transition` updates status atomically with history append.
- `inbox.archive` moves completed records after the retention window.

### Lease

- `lease.claim` returns a lease and writes the lease file atomically.
- Two parallel `claim` calls on the same task — exactly one wins.
- `lease.heartbeat` extends `expiresAt`; cross-worker heartbeat aborts safely.
- `lease.reap` releases leases past `expiresAt + grace` and writes a `recovered` history entry.
- Lease file with corrupt JSON is quarantined, not silently reaped.

### Worker

- `worker.loop` claims the next ready task and runs it through the inner loop.
- `worker.recoverOnStartup` calls `lease.reap` once before the main loop.
- `worker.heartbeat` writes to `worker-registry.json` at the configured cadence.
- Worker `SIGTERM` handler runs graceful shutdown and exits 0.

### Privilege Broker

- `registry.load` reads `config/privileges.yaml` and rejects unknown capabilities.
- `executor.execve` runs an exact `argv` with no shell.
- `executor.argvTampering` — passing extra args that do not match the registered `argv` is rejected.
- `executor.unknownCapability` fails with a structured `BrokerDeniedError`.
- `audit.append` writes one line per broker call; rotation reads `logrotate` config and works under simulated 24 h clock.

### Policy Engine Integration

- `policy.class(capability)` resolves from `config/privileges.yaml`.
- Each capability in the initial registry is mapped to the class declared in RFC-0101 §9.
- `Approval.request` creates an approval request with `expiresAt`.
- `Approval.timeout` sweeps expired requests and fails the task.

### Scheduler Adapter

- `systemd.compile(task)` produces a `.service` + `.timer` pair matching the template.
- `launchd.compile(task)` produces a `plist` with `StartCalendarInterval`.
- `cron.compile(task)` produces a crontab fragment.
- `internal.compile(task)` registers an in-process timer (and is marked not-for-production).
- Re-running install does not duplicate units (idempotency test).

## Integration Tests

### Happy Path

- Submit a task while a chat session is open; close the chat; worker still completes the task.
- Schedule a recurring task; verify it fires every N minutes under `cron` and `systemd` adapters.
- OKF pattern bundle is produced on a successful task with deliverable.
- OKF lesson bundle is produced on a classified failure.

### Concurrency

- Spin up two workers on the same host; submit 100 tasks; verify each is executed exactly once.
- Spin up a reaper script in parallel with the workers; verify no lease is reaped while still heartbeating.

### Recovery

- Kill a worker mid-task with `SIGKILL`; another worker resumes the task from its last checkpoint.
- Reboot the host (or simulate via `systemctl restart`); worker restarts; in-flight tasks recovered.
- Fill the disk to 99 %; worker pauses new claims; verify no checkpoint corruption.
- Block the notification channel for 1 hour; verify events buffer and flush on reconnect.

### Approval Flow

- Submit a `human_approval_required` task; verify the task pauses at `waiting_approval`.
- Approve the task via operator; verify the task resumes and completes.
- Deny the task; verify it transitions to `failed` with reason "approval denied".
- Let an approval expire (24 h); verify it transitions to `failed` with reason "approval timeout".

### Privilege Broker

- Request a registered capability → succeeds.
- Request an unknown capability → fails with `BrokerDeniedError`.
- Request a registered capability with mismatched args → fails.
- Verify audit log contains one entry per call with the correct shape.

## Failure-Mode Tests

| Scenario | Expected Outcome |
|---|---|
| Worker killed mid-task | Lease reaper releases; next worker resumes from checkpoint. |
| Host reboot | Supervisor restarts worker; leases reaped; checkpoints restored. |
| Filesystem full during checkpoint | Worker pauses new claims; operator notified; no half-written checkpoint. |
| Quota exhausted | Task transitions to `waiting_quota`; resumes after reset. |
| Provider returns 5xx for 30 min | Tasks wait in `waiting_quota`; resume on green health probe. |
| Clock skew between two workers | Atomic rename protects; only one heartbeat wins. |
| Privilege registry file corrupted | Worker refuses to start; clear error pointing at schema validator. |
| Approval request lost in transit | Task expires after 24 h; broker logs lost request. |
| Repeated identical failure | After `maxAttempts` the task moves to `dead_letter`; operator notified. |
| Recursive task creation (cycle) | DAG cycle detection rejects; task fails. |

## Security Tests

- Capability enumeration refuses unknown names.
- Argv tampering rejected at broker.
- Audit log cannot be rewritten by the worker (`chmod 0640`, owner `root`, group `your_app`).
- No `shell.root`, `sudo.any`, or wildcard capabilities are reachable via the registry.
- Agent cannot mutate `privileges.yaml` at runtime (no API exposed).

## Performance / Cost

- Worker steady-state CPU < 1 % on idle (verify with `pidstat -u -p <pid> 60`).
- Heartbeat write rate < 1 KB / 30 s.
- Inbox append throughput ≥ 1 000 tasks / s on local SSD.
- Lease claim latency < 5 ms on local filesystem.

## Acceptance Run

- All 25 criteria in RFC-0101 §20 must be demonstrated.
- Run the integration suite end-to-end against a clean `~/.pi/harness/` directory.
- Capture the test report under `test/reports/RFC-0101-<date>.md`.

## Required Tooling

- `bun test` (or `node --test`) for unit + integration.
- `tmux` or `setsid` for parallel-worker chaos.
- `systemd-run --scope` for supervised-worker tests on Linux.
- `logrotate --debug` for audit-log rotation tests.
- `faketime` (or equivalent) for approval-timeout and clock-skew tests.
