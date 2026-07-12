# RFC 0022 - Notification Center

## Purpose

Send runtime status, alerts, approvals, and completion messages to mobile phone/tablet.

## Motivation

Human-on-the-loop requires the human to know when the runtime is running, paused, blocked, or ready without sitting in front of pi.dev.

## MVP Channels

- Telegram
- LINE Messaging / LINE alternative
- ntfy
- Email
- Webhook

OpenClaw can be a later adapter, not an MVP dependency.

## Notification Events

```text
JobStarted
TaskCompleted
QuotaPaused
ResumeScheduled
ContextCompacted
OutputLimitContinued
E2EFailed
HumanReviewNeeded
ReadyForClient
```

## Security Rules

- Do not send raw cookies.
- Do not send passwords.
- Do not send full provider tokens.
- Do not send full source code by default.
- Send summaries and file paths.

## Acceptance Criteria

- Runtime sends at least one mobile notification.
- Notification failure does not crash runtime.
- Sensitive data is redacted.
