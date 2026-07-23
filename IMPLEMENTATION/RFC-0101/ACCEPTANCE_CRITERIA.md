# Acceptance Criteria — RFC-0101

## Implementation

- Implementation follows the RFC.
- State is durable and runtime-owned.
- Human is not required as message bus.
- Failures produce explicit records.
- Tests cover happy path and failure path.

## Functional

- A task can be submitted during a chat session and complete after the session closes.
- A scheduled task fires its cron / timer schedule with no active session.
- Two workers cannot claim the same task concurrently.
- A killed worker is replaced by another worker resuming from the last checkpoint within `leaseTTL + grace`.
- Privilege broker refuses any capability not in `config/privileges.yaml`.
- Privilege broker refuses any `argv` mismatch on a registered capability.
- `human_approval_required` tasks block at `waiting_approval` and resume on `approved`.
- `forbidden` capabilities fail the task immediately with a clear reason.
- Quota exhaustion transitions the task to `waiting_quota` and resumes on reset.
- Notifications comply with RFC-0022 rules — no secrets, no tokens, no full source.

## Operational

- The runtime runs under `systemd`, `launchd`, or Docker with restart policy verified.
- Heartbeats are written to `worker-registry.json` every 30 seconds.
- The reaper script releases expired leases correctly under a chaos test.
- The audit log accumulates one entry per broker call and rotates daily.

## Recovery

- Worker killed mid-task → recovered within `leaseTTL + grace` from the last checkpoint.
- Host reboot → worker restarts and in-flight tasks recover automatically.
- Filesystem full → worker pauses new claims without corrupting checkpoints.
- Notification channel outage → events buffer; flush on reconnect; no event loss after the outage clears.

## Integration

- Successful tasks with deliverables promote an OKF pattern bundle.
- Failed tasks after retries promote an OKF lesson bundle readable by the Master Planner.
- The Master Planner references pattern and lesson bundles during decomposition.

## Security

- No capability is a wildcard, a shell, or arbitrary `argv`.
- The agent cannot mutate `privileges.yaml` at runtime.
- The audit log cannot be rewritten by the worker — filesystem permissions enforced.
- All approval requests are signed via the operator's SSH key fingerprint.

## Performance / Cost

- Worker steady-state CPU < 1 % on idle.
- Heartbeat write rate < 1 KB / 30 s.
- Inbox append throughput ≥ 1 000 tasks / s on local SSD.

## Sanitization

- No client company names appear in the implementation files.
- No real IPs, hostnames, domains (other than the approved `bunchee.online`, `moo-ai.online`, `moocoding.com`).
- No API keys, tokens, passwords, or secrets.
- All placeholder names follow the convention `your_app`, `your-app.service`, `your-project`, `/opt/your_app`.

## Documentation

- `packages/autonomous-runtime/README.md` covers install, supervisor selection, and lifecycle.
- `packages/privilege-broker/README.md` covers capability registration.
- `packages/scheduler-adapter/README.md` covers each adapter's install + test path.
- Root `README.md` references RFC-0101 and lists the new packages.
- Bundled skill `harness-runtime/SKILL.md` documents the `/runtime` command surface.

## Done When

All of the above are demonstrated and recorded in `test/reports/RFC-0101-<date>.md`.
