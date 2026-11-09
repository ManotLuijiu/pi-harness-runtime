# Automatic resumes: the pending actions and the bounded recovery

This document describes what the harness shows and does when a provider
rejects a request. It is the repository-side description of the policy that
`wiki/unified-auto-resume-countdown-minimax-2026-11-09.md` asks for.

## The rules

1. **The executor owns the execution.** Every automatic action - a resume, a
   retry, a quota check, the decision of the judge - has exactly one owner.
   The owner schedules the action and registers the deadline it really uses.
   The registry below observes; it never dispatches.
2. **A row never claims a deadline that does not exist.** An action with a
   known deadline counts down. An action without one shows its real state
   (`queued`, `running`, `blocked`).
3. **A blocked action stays visible.** It is rendered before the countdowns,
   so an exhausted budget is not hidden by another countdown.
4. **A display tick dispatches nothing.** The ticker draws a row once per
   second while an action is pending and stops itself when there is nothing
   to draw.
5. **A deadline is the next attempt, not a promised recovery.** Every row
   says what it is waiting for.

## The registry

`harness/pending-actions.ts` holds the registry of the pending automatic
actions. An entry carries the identity of the action, the session, the owner
that scheduled it, the kind of the action, its state, and the absolute
deadline (`dueAt`) in epoch milliseconds.

```ts
pendingActions.register({
  id: "provider-recovery",
  sessionId,
  owner: "provider-recovery",
  kind: "retry",
  state: "scheduled",
  dueAt,
  attempt: 2,
  maxAttempts: 4,
  provider: "MiniMax",
  code: "2067",
  reason: "MiniMax usage limit reached (2067)",
});
```

The rows are rendered by the harness footer in their own row
(`harness-actions`), before the quota row:

```text
[BLOCKED] MiniMax 2067 | recovery attempts exhausted (4/4)
[WAIT] MiniMax 2067 | auto-resume in 03:42 | attempt 2/4 | MiniMax usage limit reached (2067)
[WAIT] Jev decision | decision in 04:59 | the decision of the judge
```

The clock is injected (`now`, `setInterval`, `clearInterval`, `tickMs`), so
the countdown is exact in the tests and independent of the wall clock in the
runtime.

## The classification of a provider failure

`harness/provider-failure.ts` classifies a failure before anything happens
with it. The kinds are few, and an unknown failure stays unknown.

| Kind | Example | May an automatic retry help? |
| --- | --- | --- |
| `rate-limit` | HTTP 429, `too many requests` | yes - with a stated `Retry-After` or a bounded backoff |
| `overload` | `overloaded_error`, peak-hour surge, HTTP 529 | yes - with a bounded backoff |
| `usage-exhausted` | `The Token Plan usage limit has been reached`, code 2067 | yes - through the bounded recovery cycle below |
| `credentials` | invalid API key, HTTP 401/403 | no - waiting does not help |
| `unknown` | an error that cannot be classified | no - it never becomes an approval, a completion, or an unlimited retry |

The wrapper a client puts around the failure it retried
(`Retry failed after 3 attempts: <the real error>`) is unwrapped first, so
the classification sees the real error.

The classification also names the **window** of the limit when the evidence
names one (`5h`, `weekly`, ...). A reset of the provider may only be used
as the floor of a retry when it belongs to the same window. The MiniMax
`Token Plan` message names no window, so the reset of the console does not
apply to it: the quota row is an observation, not a proof.

## The bounded recovery of the MiniMax 429/2067 case

`harness/provider-recovery.ts` owns the cycle. The waits between the
attempts are quadratic, and the budget is four attempts:

| Attempt | Wait after the preceding failed attempt | Nominal cumulative waiting time |
| --- | --- | --- |
| 1 | 1 minute | 1 minute |
| 2 | 4 minutes | 5 minutes |
| 3 | 9 minutes | 14 minutes |
| 4 | 16 minutes | 30 minutes |

The waits are **intervals**, not four deadlines measured from the first
error: the second attempt is scheduled after the first attempt actually ran
and failed again. The cumulative column leaves out the time the requests
themselves took.

The deadline of an attempt is the latest of three facts:

```ts
const dueAt = Math.max(
  failureObservedAt + attempt * attempt * 60_000,
  applicableResetAt === undefined ? 0 : applicableResetAt + 30_000,
  applicableRetryAfterAt ?? 0,
);
```

- the quadratic policy of the attempt,
- an applicable reset plus a 30 second buffer - only when the observation is
  fresh, names the same provider, and belongs to the same window,
- an applicable `Retry-After` of the evidence.

A missing, stale, expired, or mismatched reset leaves the quadratic policy
in force. It never invents a provider recovery time.

The lifecycle of the cycle:

- The cycle is keyed by the session, the provider, and the kind of the
  failure. A session change starts a new cycle.
- A repeated copy of the same error neither reschedules the pending attempt
  nor resets the counter.
- The attempt uses the **existing** auto-resume executor
  (`queueAutoResume` with the established `resume` message), so there is no
  second resume loop next to the established one.
- The pending action shows the exact deadline the timer uses, and the
  countdown leaves when the attempt runs.
- A successful turn ends the cycle and resets the counter. Queuing a resume
  or reading a positive quota snapshot is not success.
- After the fourth attempt fails, the row shows
  `[BLOCKED] MiniMax 2067 | recovery attempts exhausted (4/4)` and no fifth
  attempt is scheduled. A manual retry may start a new cycle; a refresh of
  the interface may not.
- A credential failure is never retried by this policy. Buying credits or
  changing billing settings stays outside the automatic recovery.

## The failures that own an executor

| Failure | Kind | The executor |
| --- | --- | --- |
| `429`, a rate limit without a deadline | `rate-limit` | the bounded recovery cycle (1, 4, 9, 16 minutes) |
| `429` with a `Retry-After` | `rate-limit` | the bounded recovery cycle, with the stated deadline as a lower bound |
| `2067`, the usage limit of MiniMax | `usage-exhausted` | the bounded recovery cycle |
| `529`, the peak hour of GLM | `overload` | the existing overload executor (a short random delay, its own limit) |
| `401`, `403` | `credentials` | none - the row says that nothing is scheduled |

One failure has one executor. An overload does not enter the cycle, so a
failure never ends up with two resume loops, and the cycle never
duplicates the executor that already exists.

## The owners that are registered today

| Automatic action | Owner | What the row shows |
| --- | --- | --- |
| The decision of the judge | `harness/pending-countdown.ts` | the deadline of the decision, taken from the countdown itself |
| The bounded recovery of a provider | `harness/provider-recovery.ts` | the exact deadline of the next attempt, with the attempt of the budget |
| The resume of a job after the quota | `harness/auto-quota-resume.ts` | the moment the resume really runs, not the reset of the quota |
| The countdown of the GLM quota | `harness/glm-quota-countdown.ts` | the reset the countdown waits for |
| The continuation of the output limit | `index.ts` | `queued` - it runs right away, so it has no countdown |
| The continuation of the compaction | `index.ts` | `queued` - it runs right away, so it has no countdown |

The job resume and the GLM countdown report their deadline through an
observer, so their modules stay independent of the display. The row of a
countdown leaves when the countdown ends: it never stays at `00:00`.

## What this does not cover

- **The retries of Pi and of the provider SDK.** The core of Pi declares
  `auto_retry_start` and `auto_retry_end` for its own session
  (`core/agent-session.d.ts`), and the interactive mode consumes them: it
  shows a retry indicator and restores the escape handler. The extension
  API of the core does not expose them (`core/extensions/types.d.ts`), and
  the extension context carries no handle of the agent session, so an
  extension cannot subscribe to them. The `subscribe` of the SDK belongs to
  an application that embeds Pi, not to an extension.

  The consequence is narrow: the harness does not observe the countdown of
  the internal retry of Pi. Its own bounded recovery is *additional* to
  that retry, never a replacement for it, and the harness does not claim
  to cover it.

  The finding is checked, not believed:
  `test/pi-retry-visibility.test.mjs` reads the declarations of the
  installed core and fails on purpose when a newer core exposes the events
  to extensions. That is the moment to wire the bridge.
- **The restored state after a restart.** The job resume persists its
  `resumeAt` in the checkpoint, but a persisted timestamp does not recreate
  an in-memory timer. A restart therefore shows no countdown until the job
  schedules its resume again.
- **The quota as a proof.** A reset of the console is an observation. It
  only becomes the floor of a retry when it is fresh, names the same
  provider, and belongs to the same window as the failure.
