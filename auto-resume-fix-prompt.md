# Auto-Resume Fix After Context Overflow Compaction

## Problem Statement

After context overflow compaction with `willRetry=false`, the agent does NOT automatically resume. The session pauses waiting for user input, even though context-mode has a resume snapshot that should be delivered.

## Root Cause Analysis

### The Compaction Flow

1. **Context overflow occurs** → `_checkCompaction()` is called
2. **For overflow with `stopReason === "stop"`** (the common case):
   - `willRetry = assistantMessage.stopReason !== "stop"` → **FALSE**
   - Calls `_runAutoCompaction("overflow", false)`
3. **Inside `_runAutoCompaction`** (line 1685):

   ```javascript
   return this.agent.hasQueuedMessages();  // ← Returns FALSE for overflow case!
   ```

4. **Result**: Session pauses waiting for user input

### Why Context-Mode Resume Wasn't Delivered

Context-mode builds resume snapshot in `session_before_compact` and stores it in DB:

```javascript
// From extension.js
pi.on("session_before_compact", () => {
    const snapshot = buildResumeSnapshot(allEvents, { compactCount });
    db.upsertResume(_sessionId, snapshot, allEvents.length);
});
```

But resume was only injected in `before_agent_start` via the `context` hook:

```javascript
pi.on("before_agent_start", async (event, ctx) => {
    const resume = db.getResume(_sessionId);
    if (resume && !resume.consumed && resume.snapshot) {
        parts.push(resume.snapshot);
        db.markResumeConsumed(_sessionId);
    }
    // ...
});
```

**Problem**: `before_agent_start` only fires when a **new prompt is submitted**. After overflow compaction with `willRetry=false`, no prompt is submitted → resume is never delivered.

## Solution Implemented: Post-Compaction Message Queue

Added a new extension API `queuePostCompactionMessage()` that allows extensions to queue messages that should be delivered after compaction completes, even when `willRetry=false`.

### Flow After Fix

1. `session_before_compact` → Build resume snapshot in DB
2. `session_compact` → Queue resume via `ctx.queuePostCompactionMessage()`
3. After compaction completes → `drainPostCompactionMessages()` delivers queued messages
4. Agent continues and delivers resume automatically

## Files Changed

### 1. `pi-coding-agent/dist/core/extensions/types.d.ts`

Added new API to `ExtensionContext` and `ExtensionContextActions`:

```typescript
// ExtensionContext
/**
 * Queue a message to be delivered after compaction completes.
 * When willRetry=false (e.g. overflow without context recovery), the agent
 * will continue and deliver these queued messages before pausing for user input.
 * Useful for resuming context-mode's snapshot after overflow compaction.
 */
queuePostCompactionMessage(message: { role: string; content: string }): void;

// ExtensionContextActions
queuePostCompactionMessage: (message: { role: string; content: string }) => void;
```

### 2. `pi-coding-agent/dist/core/extensions/runner.js`

Added new methods to `ExtensionRunner`:

```javascript
// Instance variable
_postCompactionMessages = [];

// Method to queue messages (called from extension context)
queuePostCompactionMessageFn = (message) => {
    this._postCompactionMessages.push(message);
};

// Method to get and clear messages (called by agent-session after compaction)
drainPostCompactionMessages() {
    if (this.staleMessage) {
        return [];  // Don't drain if stale
    }
    const messages = this._postCompactionMessages;
    this._postCompactionMessages = [];
    return messages;
}

// Check if runner is stale (without throwing)
isStale() {
    return Boolean(this.staleMessage);
}
```

### 3. `pi-coding-agent/dist/core/agent-session.js`

Modified `_runAutoCompaction()` to check for and deliver post-compaction messages:

```javascript
// After compaction completes (line 1682)
this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

if (willRetry) {
    // ... existing retry logic
    return true;
}

// Check for post-compaction messages from extensions
if (this._extensionRunner && !this._extensionRunner.isStale()) {
    const postCompactionMessages = this._extensionRunner.drainPostCompactionMessages();
    for (const msg of postCompactionMessages) {
        await this.agent.followUp(msg.content);
    }
    if (postCompactionMessages.length > 0) {
        return true; // Continue to deliver the queued messages
    }
}

// Fall back to existing behavior
return this.agent.hasQueuedMessages();
```

### 4. `context-mode/build/adapters/pi/extension.js`

Modified `session_compact` handler to queue resume:

```javascript
pi.on("session_compact", (event, ctx) => {
    try {
        if (!_sessionId)
            return;
        db.incrementCompactCount(_sessionId);

        // Queue resume snapshot for post-compaction delivery when willRetry=false
        if (!event.willRetry) {
            const resume = db.getResume(_sessionId);
            if (resume && !resume.consumed && resume.snapshot) {
                ctx.queuePostCompactionMessage?.({
                    role: "user",
                    content: resume.snapshot,
                });
                db.markResumeConsumed(_sessionId);
            }
        }
    }
    catch {
        // best effort
    }
});
```

## Testing

To verify the fix works:

1. **Trigger context overflow** with a long conversation
2. **Observe compaction happens automatically**
3. **Agent continues WITHOUT user input**
4. **Resume snapshot is delivered** and agent continues working

Check with:

```bash
pi
# Run a long conversation that triggers overflow
# Verify agent continues automatically after compaction
/ctx-stats
```

## Backward Compatibility

- The new `queuePostCompactionMessage` API is optional (uses `?.` when calling)
- Extensions that don't use it continue to work unchanged
- Existing behavior for `willRetry=true` cases is preserved
