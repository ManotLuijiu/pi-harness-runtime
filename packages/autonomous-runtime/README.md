# Autonomous Runtime — RFC-0101

Task Inbox, Task Lease, and worker supervision for autonomous post-session execution.

## Package

`@pi-harness/autonomous-runtime`

## Concepts

### Task Inbox

Durable queue of tasks submitted by the harness master planner. Survives worker crashes, host reboots, and provider quota exhaustion.

### Task Lease

Atomic exclusive claim on a task. Guarantees **single-execution** under crash recovery. Other workers skip a leased task.

### Worker

Supervised process that reads from the inbox, claims tasks via leases, executes, and reports results.

## Usage

```ts
import { TaskInbox, TaskLeaseManager, WORKER_ROOT } from "@pi-harness/autonomous-runtime";

const inbox = new TaskInbox();
const leaseMgr = new TaskLeaseManager();

// Submit a task
await inbox.submit({
  title: "Fix login bug",
  description: "Users cannot log in with SSO",
  capability: "write",
});

// Worker: claim and work
const task = await inbox.claimNext("worker-1", leaseMgr);
if (task) {
  // ... do work ...
  await inbox.complete(task.id, { success: true });
}
```

## Status

**Phase 1 done.** Phases 2–10 pending implementation.
