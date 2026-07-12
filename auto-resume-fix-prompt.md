# Auto-Resume Fix After Context Overflow Compaction

## Problem Statement

After context overflow compaction with `willRetry=false`, the agent does NOT automatically resume. The session pauses waiting for user input, even though context-mode has a resume snapshot that should be delivered.

## Root Cause Analysis

### The Compaction Flow

1. **Context overflow occurs** → `_checkCompaction()` is called
2. **For overflow with `stopReason === "stop"`** (the common case):
   - `willRetry = assistantMessage.stopReason !== "stop"` → **FALSE**
   - Calls `_runAutoCompaction("overflow", false)`
3. **Inside `_runAutoCompaction`**:

   ```javascript
   // Line 1621-1632
   this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });
   if (willRetry) {
       // ... retry logic
       return true;
   }
   // Auto-compaction can complete while follow-up/steering/custom messages are waiting.
   // Continue once so queued messages are delivered.
   return this.agent.hasQueuedMessages();  // ← Returns FALSE for overflow case!
   ```

4. **Result**: `hasQueuedMessages()` returns `false` → session pauses

### Why Context-Mode Resume Isn't Delivered

Context-mode builds resume snapshot in `session_before_compact` and stores it in DB:

```javascript
// From extension.js
pi.on("session_before_compact", () => {
    const snapshot = buildResumeSnapshot(allEvents, { compactCount });
    db.upsertResume(_sessionId, snapshot, allEvents.length);
});
```

But resume is injected only in `before_agent_start` via the `context` hook:

```javascript
pi.on("before_agent_start", async (event, ctx) => {
    const resume = db.getResume(_sessionId);
    if (resume && !resume.consumed && resume.snapshot) {
        parts.push(resume.snapshot);
        db.markResumeConsumed(_sessionId);  // Marked consumed here
    }
    // ...
});

pi.on("context", (event) => {
    event.messages.push({ role: "user", content: ctx });
    return { messages: event.messages };
});
```

**Problem**: `before_agent_start` only fires when a **new prompt is submitted**. After overflow compaction with `willRetry=false`, no prompt is submitted → resume is never delivered.

## Fix Options

### Option 1: Queue Resume as Follow-Up Message (Recommended for context-mode)

Modify context-mode to add the resume to the agent's follow-up queue during `session_compact`:

**Problem**: Extensions don't have direct access to `agent.followUp()`.

**Solution**: Add a new extension API mechanism:

```typescript
// In ExtensionContext or session_compact handler:
ctx.queueFollowUp?.(message)  // New API
```

### Option 2: Return `true` to Continue After Overflow Compaction

Modify `_runAutoCompaction` to continue when overflow compaction completes (even with `willRetry=false`):

```javascript
// In _runAutoCompaction, after compaction completes:
if (reason === "overflow" && !willRetry) {
    // Still continue after overflow - resume context should be delivered
    return true;
}
return this.agent.hasQueuedMessages();
```

**Downside**: This changes the fundamental design choice that overflow cases require user intervention.

### Option 3: Add `session_compact_end` Hook with Continuation Support

Add a new hook that fires after compaction completes and can trigger continuation:

```typescript
pi.on("session_compact_end", async (event, ctx) => {
    if (!event.willRetry && event.reason === "overflow") {
        // Trigger continuation - context hook will fire and deliver resume
        ctx.continue?.();  // New API needed
    }
});
```

## Implementation Guide for Option 1 (context-mode fix)

### Step 1: Add API to ExtensionContext

In `pi-coding-agent/dist/core/extensions/types.d.ts`:

```typescript
export interface ExtensionContext {
    // ... existing methods ...
    /** Queue a message for delivery after compaction (if willRetry=false) */
    queuePostCompactionMessage?: (message: { role: string; content: string }) => void;
}
```

### Step 2: Implement in ExtensionRunner

Store queued messages and expose them via `getPostCompactionMessages()`.

### Step 3: Modify Agent Loop

After compaction completes, check for post-compaction messages and inject them.

### Step 4: Update context-mode Extension

```javascript
pi.on("session_compact", async (event, ctx) => {
    if (!event.willRetry && event.reason === "overflow") {
        const resume = db.getResume(_sessionId);
        if (resume && !resume.consumed && resume.snapshot) {
            ctx.queuePostCompactionMessage?.({
                role: "user",
                content: resume.snapshot
            });
        }
    }
});
```

## Verification

After fix:

1. Trigger context overflow (long conversation)
2. Compaction happens automatically
3. Agent continues WITHOUT user input
4. Resume snapshot is delivered and agent continues working
