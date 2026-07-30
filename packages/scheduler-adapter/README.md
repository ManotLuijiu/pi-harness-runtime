# Scheduler Adapter

Pluggable scheduling backend for pi-harness-runtime.

## Backends

| Backend | File | When to use |
|---|---|---|
| Internal (in-process) | `internal.ts` | Local dev, testing, no system deps |
| Cron | `cron.ts` | Linux/macOS with cron |
| systemd | `systemd.ts` | Linux with systemd (recommended for autonomous) |

## Usage

```typescript
import { SystemdAdapter } from "./index.js";

const scheduler = new SystemdAdapter();
await scheduler.install();
await scheduler.schedule({
  id: "nightly-compact",
  taskTemplate: { kind: "compact" },
  schedule: { kind: "cron", expression: "0 3 * * *" },
});
```

## Adapter Interface

```typescript
interface SchedulerAdapter {
  install(): Promise<void>;
  schedule(task: ScheduledTask): Promise<void>;
  unschedule(taskId: string): Promise<void>;
  listScheduled(): Promise<ScheduledTask[]>;
}
```
