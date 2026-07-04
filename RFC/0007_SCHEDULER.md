# RFC 0007 - Scheduler

## Purpose
Decide when to run, pause, retry, or resume work.

## Scheduling Reasons
- quota_reset
- retry_after_error
- wait_for_human
- run_next_task
- cancelled

## Goals
- Resume jobs after quota reset.
- Retry temporary failures with backoff.
- Persist scheduled resume times.
- Work locally without cloud services.

## v0.1 Implementation
Use a local JSON schedule file and polling.

## Interface
```ts
interface RuntimeScheduler {
  scheduleResume(jobId: string, resumeAt: string, reason: string): Promise<void>;
  dueJobs(now: Date): Promise<string[]>;
  cancel(jobId: string): Promise<void>;
}
```

## Future
SQLite queue, systemd timer, cron, BullMQ, or external orchestrator.
