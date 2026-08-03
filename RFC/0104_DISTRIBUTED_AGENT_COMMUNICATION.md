# RFC-0104 — Distributed Agent Communication Runtime

> **Status:** Proposed
> **Author:** pi-harness-runtime
> **Replaces:** N/A
> **Superseded by:** N/A
> **Depends on:** RFC-0103 (Local Session Event Runtime)

---

## Summary

Cross-machine agent communication using Google A2A protocol, complementing RFC-0103's local event bus with distributed task routing, agent discovery, and inter-host communication.

---

## Motivation

RFC-0103 provides local machine communication:

```
Session Event Runtime → Event Bus → Local Subscribers
```

This RFC enables cross-machine communication:

```
Machine A                    Machine B
  └── pi-harness-runtime ←→ pi-harness-runtime
         ↓                       ↓
    A2A Adapter            A2A Adapter
         ↓                       ↓
    Task Request           Task Response
```

**Use cases:**

- Remote sub-agents on other machines
- Distributed task execution
- Agent federation across workstations

---

## Architecture

```
pi-harness-runtime (Local)
        │
        ├── RFC-0103: Session Event Runtime (local)
        │
        └── RFC-0104: A2A Adapter (remote)

Remote pi-harness-runtime
        │
        └── A2A Server (HTTP)
```

---

## Reuse Existing Package

`packages/a2a-adapter/` — implement Google A2A protocol.

### Key Features from A2A Spec

| Feature | Description |
|---------|-------------|
| Agent Card | JSON manifest for agent capabilities |
| Task Protocol | Create, submit, cancel tasks |
| Streaming | Server-sent events for progress |
| Push Notifications | Webhook-style callbacks |

---

## Agent Card Schema

```typescript
interface AgentCard {
  name: string;
  version: string;
  description: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: string[];
  endpoints: {
    a2a: string;  // URL to A2A server
  };
}
```

---

## A2A Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agents/{id}` | Get agent card |
| POST | `/tasks` | Create task |
| GET | `/tasks/{id}` | Get task status |
| POST | `/tasks/{id}/cancel` | Cancel task |
| GET | `/tasks/{id}/messages` | Stream messages |

---

## Integration with RFC-0103

```typescript
// Local event bus (RFC-0103)
eventBus.publish('task.remote_assigned', task);

// Remote A2A (RFC-0104)
const response = await a2aClient.sendTask({
  agentId: 'worker@other-machine',
  task: task
});

// Local subscription (RFC-0103)
eventBus.subscribe('task.remote_result', handler);
```

---

## Security

| Concern | Mitigation |
|---------|------------|
| Unauthorized access | API key / token auth |
| Network isolation | Private network or VPN |
| Task validation | Signature verification |

---

## Files

See `IMPLEMENTATION/RFC-0104/FILES.md`.

---

## Acceptance Criteria

See `IMPLEMENTATION/RFC-0104/ACCEPTANCE_CRITERIA.md`.
