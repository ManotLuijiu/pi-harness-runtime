# Auto-Compact and Continue Architecture

## Overview

This document describes how pi-harness-runtime automatically recovers from context window exhaustion without human intervention.

## The Problem

LLM context windows are limited (e.g., 32K-1M tokens). When a conversation exceeds this limit:

1. **Proactive**: The model stops before reaching the limit to avoid truncation
2. **Reactive**: The API returns `413 Payload Too Large` or `prompt_too_long`

## The Solution

pi-harness-runtime implements a **two-phase compact system**:

### Phase 1: Proactive Compact (Before API Call)

```
LoopRuntime.executeTaskWithCompact()
    │
    ├─► CompactOrchestrator.invokeWithCompact()
    │       │
    │       ├─► estimateTokensWithBuffer()
    │       │       └── Calculates token usage with buffer awareness
    │       │
    │       ├─► shouldProactiveCompact() 
    │       │       └── Returns true if > 85% utilization
    │       │
    │       └─► runFullCompact()
    │               │
    │               ├─► summarizeViaForkedAgent()
    │               │       └── LLM summarizes old messages (forked)
    │               │
    │               ├─► generateBoundary()
    │               │       └── Creates compact marker message
    │               │
    │               └─► modifies messages[] in-place
    │
    └─► invoke() with compacted messages
```

### Phase 2: Reactive Compact (On Error)

```
invoke() ──► API returns error
    │
    ├─► isContextTooLongError() detects context-too-long
    │
    ├─► runFullCompact() summarizes recent messages
    │
    └─► retry invoke() with compacted messages
```

## Key Components

### 1. ContextWindowManager

Manages token tracking and circuit breaker:

```typescript
// Constants
AUTOCOMPACT_BUFFER_TOKENS = 13_000      // Reserve for output
WARNING_THRESHOLD = 20_000             // Warning at 80%
BLOCKING_THRESHOLD = 20_000            // Block at 80%
MAX_CONSECUTIVE_COMPACT_FAILURES = 3   // Circuit breaker
```

### 2. CompactOrchestrator

Wraps LLM invocations with compact checks:

```typescript
// Proactive: 85% utilization
if (shouldProactiveCompact(estimate)) {
    await runFullCompact(messages, model, ...);
}

// Reactive: on context-too-long error
if (isContextTooLongError(result.error)) {
    await runFullCompact(messages, model, ...);
    const retryResult = await invoke(opts);  // Auto-retry!
}
```

### 3. ForkedSummarizer

Uses separate LLM call for summarization:

```typescript
// Forked: separate process to avoid same context-too-long error
const result = await forkedAgent.summarize(messages, {
    focusOn: "work_done"
});
```

### 4. ContinuePromptGenerator

Generates context-aware continue prompts:

```typescript
// Boundary marker for message history
generateBoundary({ summary, reason, messagesCompacted }) 
// → "[Earlier conversation summarized]"

// Continue prompt for retry
generateMinimal({ summary, recentMessages })
// → "Continue from where you left off. Do not repeat work..."
```

### 5. LoopRuntime

Integrates compact into the main execution loop:

```typescript
while (compactRetries < maxCompactRetries) {
    const result = await orchestrator.invokeWithCompact(opts, callbacks);
    
    if (result.success) {
        // Normal completion
        return;
    }
    
    if (result.compactResult) {
        // Compact happened - auto-retry
        compactRetries++;
        if (result.continueMessage) {
            messages.push({ role: "user", content: result.continueMessage });
        }
        continue;  // Retry!
    }
    
    throw new Error(result.error);
}
```

## Circuit Breaker Pattern

Prevents infinite compact loops:

```typescript
// After 3 consecutive failures, stop trying
if (consecutiveFailures >= MAX_CONSECUTIVE_COMPACT_FAILURES) {
    return { 
        success: false, 
        error: "Compact circuit breaker engaged" 
    };
}
```

## Continue Prompt Flow

```
┌─────────────────────────────────────────────────────────┐
│                    COMPACTION EVENT                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Save partial artifacts (PartialRecovery)             │
│    - Partial outputs from before compact                 │
│    - Task state                                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Generate summary (ForkedSummarizer)                  │
│    - LLM summarizes old messages                        │
│    - Focus on work done, decisions, remaining work       │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Modify messages[] in-place                           │
│    - Remove old messages                                │
│    - Insert boundary marker                             │
│    - Keep recent messages                               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Generate continue prompt                             │
│    - "Continue from where you left off"                 │
│    - Include summary of earlier work                    │
│    - Include remaining work items                       │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Auto-retry invoke                                   │
│    - Messages now fit in context window                │
│    - Model receives continue prompt                     │
│    - Work continues automatically                       │
└─────────────────────────────────────────────────────────┘
```

## Configuration

```typescript
// Default values
const config = {
    autoCompactThreshold: 0.85,      // Compact at 85%
    blockingThreshold: 0.97,         // Block at 97%
    maxCompactAttempts: 3,           // Max retries
    microcompactTimeGapMs: 30 * 60 * 1000,  // 30 min
    microcompactKeepRecent: 2,       // Keep last 2 tool results
};

// Environment overrides
AUTOCOMPACT_BUFFER_TOKENS=13000      // Override buffer size
DISABLE_AUTO_COMPACT=true            // Disable auto-compact
DISABLE_COMPACT=true                // Disable all compact
```

## Difference from Reference Implementation

The pi-harness-runtime implementation mirrors the reference implementation:

| Feature | Reference | pi-harness-runtime |
|---------|-----------|---------------------|
| Proactive compact | ✅ | ✅ |
| Reactive compact | ✅ | ✅ |
| Circuit breaker | ✅ | ✅ |
| Forked summarization | ✅ | ✅ |
| Compact boundary markers | ✅ | ✅ |
| Auto-retry after compact | ✅ | ✅ |
| Continue prompts | ✅ | ✅ |

## Usage

```typescript
import { CompactOrchestrator } from "./harness/index.js";

// Create orchestrator
const orchestrator = new CompactOrchestrator({
    jobId: "job-1",
    provider: "minimax",
    model: "MiniMax-M3",
});

// Execute with compact
const result = await orchestrator.invokeWithCompact(
    { messages, model, maxOutputTokens },
    {
        invokeAgent: myAgentInvoke,
        onCheckpoint: (r) => saveCheckpoint(r),
        summarizeViaForkedAgent: forkedSummarize,
    }
);

// If compact happened, result includes continue message
if (result.compactResult) {
    console.log(`Compacted from ${result.compactResult.beforeTokens} tokens`);
}
```

## Files

- `harness/context-window-manager.ts` - Token tracking, circuit breaker
- `harness/auto-compact.ts` - Compact detection, continue prompts
- `harness/continue-prompt.ts` - Prompt generation
- `harness/context-compact-orchestrator.ts` - Integration layer
- `harness/forked-summarizer.ts` - Forked LLM summarization
- `harness/partial-recovery.ts` - Artifact persistence
- `harness/loop-runtime.ts` - Main loop integration
