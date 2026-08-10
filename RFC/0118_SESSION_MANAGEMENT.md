# RFC-0118 — Session Management

## Purpose

Manage pi-coding-agent session lifecycle and state.

## Motivation

Sessions need:

- Creation and teardown
- State persistence
- Session metadata tracking
- Multi-session coordination

## Architecture

```text
Session Manager
    |
    +-> Create new session
    +-> Restore from checkpoint
    +-> Save state on exit
    +-> Session list/query
```

## Key Components

### manager.ts

- Create/destroy sessions
- Track session metadata
- Handle session events

### session-api.ts

- REST API for session management
- List active sessions
- Get session state

## Files

See `IMPLEMENTATION/RFC-0118/FILES.md`.

## Acceptance Criteria

- [ ] Create new sessions
- [ ] Restore sessions from checkpoint
- [ ] Track session metadata
- [ ] Expose session API
