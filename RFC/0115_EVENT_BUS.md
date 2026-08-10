# RFC-0115 — Event Bus

## Purpose

Pub/sub implementation for runtime event communication.

## Motivation

Loose coupling between components via events:

- Session events (start/end, task complete)
- Cross-tab communication via file-based bus
- Topic-based subscriptions

## Architecture

```text
Publisher -> Event Bus -> Subscribers
              |
              +-> In-Memory Bus (same process)
              +-> HerdrEventBus (cross-process via JSONL)
```

## HerdrEventBus

File-based cross-process bus for herdr tabs:

```typescript
const bus = new HerdrEventBus({
  workspace: "/path/to/.herdr-bus/",
  flushInterval: 100,
});

bus.publish("task:complete", { taskId: "123" });
bus.subscribe("task:complete", (data) => {
  console.log("Task completed:", data);
});
```

## Files

See `IMPLEMENTATION/RFC-0115/FILES.md`.

## Acceptance Criteria

- [ ] In-memory pub/sub works
- [ ] HerdrEventBus syncs via JSONL files
- [ ] Topic wildcards supported
- [ ] Unsubscribe works correctly
