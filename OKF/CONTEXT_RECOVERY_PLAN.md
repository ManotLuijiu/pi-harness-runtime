# Context Window Recovery — pi-harness-runtime Improvement Plan

## Problem Statement

When the context window fills up during agent execution:

- **Reference implementation**: Auto-compacts messages, generates a continuation prompt, resumes work without human intervention.
- **pi-harness-runtime**: Does not automatically resume after compaction — the human is left to copy/paste a continue prompt manually.

---

## Root Cause Analysis

| Aspect | Reference | pi-harness-runtime |
|---|---|---|
| Token estimation pre-check | `compact.ts` → `willExceedLimit()` | `context-window-manager.ts` (exists, not wired) |
| Microcompact | Strips tool results, keeps summaries | `auto-compact.ts` → `generateMicroCompact()` (exists, not called) |
| Full compact | `compactConversation()` + `generateContinuePrompt()` | `auto-compact.ts` → `generateContinuePrompt()` (exists, not called) |
| Post-compact invoke | `invokeWithCompact()` retries automatically | No retry loop — returns to caller |
| Continuation state | `compact.ts` saves `post_compact_messages` + `continue_prompt` | `partial-recovery.ts` (exists, not wired) |
| Resume trigger | `main.ts` checks `isPostCompaction()` on next tick | No `markPostCompaction()` equivalent |

**Key gap**: pi-harness-runtime has all the building blocks but no orchestration layer that wires them together into an auto-resume loop.

---

## Proposed Architecture

```
LoopRuntime.executeTask()
  └─> CompactOrchestrator.invokeWithCompact()
        ├─> beforeInvoke():
        │     1. Estimate token count
        │     2. Update ContextWindowManager
        │     3. Microcompact: prune tool results if near limit
        │
        ├─> agent.invoke()
        │
        └─> afterInvoke():
              ├─ on output_limit → OutputLimitHandler.truncate()
              ├─ on context_window_full → autoCompactIfNeeded()
              │     1. Full compact conversation
              │     2. Generate continue prompt
              │     3. Save partial artifacts
              │     4. Save compaction event
              │     5. Return ContinueRequired → LoopRuntime retries
              │
              ├─ on success → emit task result
              └─ on error → propagate / retry / escalate
```

---

## Files to Implement / Update

### 1. `harness/compact-orchestrator.ts` (NEW — integration layer)

Responsibilities:

- `invokeWithCompact<T>()` — wraps agent.invoke() with before/after hooks
- `beforeInvoke()` — token estimation + microcompact
- `afterInvoke()` — routes result, triggers full compact, returns `ContinueRequired` if needed
- `shouldRetry()` — checks retry budget, quota state
- `estimateTokens()` — delegates to context-window-manager

### 2. `harness/compact-state.ts` (NEW — shared state)

```typescript
export interface CompactState {
  attempt: number;
  totalCompactions: number;
  messages: CompactableMessage[];
  continuePrompt: string;
  partialArtifacts: Record<string, string>;  // filename → partial content
  compactionHistory: CompactionRecord[];
}
```

### 3. `harness/context-window-manager.ts` (EXISTING — wire it up)

Add:

- `estimatePromptTokens(messages, model)` — pre-invoke estimation
- `shouldPrecompact(messages, model, threshold?)` — threshold-based microcompact
- `getUtilization()` — percentage used, for telemetry

### 4. `harness/auto-compact.ts` (EXISTING — wire afterInvoke)

Changes:

- Export `generateContinuePrompt()` and `compactConversation()` for orchestrator
- Add `buildContinuePrompt(messages, summary)` — cleaner continuation
- Add `detectCompactionReason(stopReason, usage)` — distinguish context_full vs quota

### 5. `harness/partial-recovery.ts` (EXISTING — wire into compact flow)

Changes:

- `savePartialArtifact()` → called after each tool_use block in afterInvoke
- `loadPartialArtifacts()` → called on retry to reconstruct partial state
- `markPostCompaction()` → writes flag file for next tick to detect

### 6. `harness/loop-runtime.ts` (EXISTING — add retry loop)

Changes:

- Replace `agent.invoke()` call with `CompactOrchestrator.invokeWithCompact()`
- Add retry loop: if result is `ContinueRequired`, prepend continue prompt, re-invoke
- Track `compactState` on the `RuntimeTask` so resume is stateful
- Respect `LoopConfig.maxRetries`, `LoopConfig.pauseOnQuota`

### 7. `harness/output-limit-handler.ts` (EXISTING — ensure truncation works)

Changes:

- `truncateOutput()` — extract trailing complete blocks, discard overflow
- Return `{ truncatedText, keptBlocks }` so orchestrator can decide compact vs. retry
- Add `isLikelyContextFull(usage)` helper — check `usage提示_tokens > 0.85 * max`

### 8. `packages/types/src/runtime-types.ts` (EXISTING — add types)

Add:

```typescript
export type CompactResult =
  | { type: 'success'; messages: Message[] }
  | { type: 'continue_required'; continuePrompt: string; compactState: CompactState }
  | { type: 'paused_quota'; quotaState: QuotaState }
  | { type: 'error'; error: string };

export interface CompactionRecord {
  timestamp: string;
  reason: 'context_window_full' | 'output_limit' | 'microcompact';
  preCompactTokens: number;
  postCompactTokens: number;
  messagesRemoved: number;
}
```

---

## Integration Checklist

- [ ] `CompactOrchestrator` instantiated in `LoopRuntime` constructor
- [ ] `beforeInvoke()` called before every agent.invoke()
- [ ] `afterInvoke()` handles output_limit → truncate → maybe compact
- [ ] `ContinueRequired` result causes retry with prepended continue prompt
- [ ] Partial artifacts saved and restored across retries
- [ ] Compaction events logged to `harness/context/compaction_events.jsonl`
- [ ] `markPostCompaction()` flag set on successful resume
- [ ] `pauseOnQuota` respected — pause job, don't spin

---

## Testing Strategy

1. **Unit**: Each orchestrator method independently testable
2. **Integration**: Mock agent.invoke() → verify compact → verify retry
3. **E2E simulation**: Feed artificially long message list → verify auto-resume

---

## Priority Order

1. `compact-state.ts` — define shared types first
2. `compact-orchestrator.ts` — core integration layer
3. Wire into `loop-runtime.ts` — enable the retry loop
4. Wire `context-window-manager.ts` — token estimation
5. Wire `auto-compact.ts` — continuation prompt generation
6. Wire `partial-recovery.ts` — artifact persistence
7. Add types to `runtime-types.ts` — complete type safety

---

## Notes

- Reference implementation uses `lodash-es`, `bun:bundle` features. pi-harness-runtime has zero runtime deps — keep it that way.
- All existing files (`auto-compact.ts`, `context-window-manager.ts`, `partial-recovery.ts`, `output-limit-handler.ts`) are already written — this plan is about **wiring**, not rewriting.
- The orchestrator should be a thin layer over the existing building blocks.

---

## Implementation Status (2026-07-10)

### ✅ Completed

| Phase | Component | Status |
|-------|-----------|--------|
| 1 | `context-window-manager.ts` enhanced | ✅ Complete |
| | - Added `AUTOCOMPACT_BUFFER_TOKENS = 13,000` | ✅ |
| | - Added `MAX_CONSECUTIVE_COMPACT_FAILURES = 3` circuit breaker | ✅ |
| | - Added `estimateTokensWithBuffer()` with utilization | ✅ |
| | - Added `shouldProactiveCompact()` / `shouldBlockApiCall()` | ✅ |
| | - Added `recordCompactFailure()` / `recordCompactSuccess()` | ✅ |
| | - Added `microcompactToolResults()` helper | ✅ |
| | - Added `parseTokenGapFromError()` for PTL errors | ✅ |
| 2 | `forked-summarizer.ts` | ✅ New file created |
| | - `ForkedSummarizer` class | ✅ |
| | - `summarize()` with keepRecentCount | ✅ |
| | - `heuristicSummary()` fallback | ✅ |
| | - `createForkedSummarizer()` factory | ✅ |
| 5 | `continue-prompt.ts` | ✅ New file created |
| | - `ContinuePromptGenerator.generate()` | ✅ |
| | - `generateMinimal()` for quick resume | ✅ |
| | - `generateBoundary()` for message history | ✅ |
| | - `fromCompactResult()` extractor | ✅ |
| 3 | `context-compact-orchestrator.ts` enhanced | ✅ Complete |
| | - Integrated ContextWindowManager | ✅ |
| | - Added circuit breaker logic | ✅ |
| | - Added `onPreCompact` / `onPostCompact` callbacks | ✅ |
| | - Integrated ContinuePromptGenerator | ✅ |
| | - Added `isContextTooLongError()` detection | ✅ |
| | - Added `preserveRecentToolResults()` | ✅ |

### 📋 Remaining

| Phase | Component | Priority |
|-------|-----------|----------|
| 4 | Session memory system | Medium |
| | `harness/session-memory.ts` | |
| | Persistent knowledge extraction | |
| | Re-inject on resume | |
| 6 | Wire into loop-runtime.ts | High |
| | Replace `agent.invoke()` with `CompactOrchestrator` | |
| | Add retry loop for `ContinueRequired` | |
| 7 | Wire partial-recovery.ts | Medium |
| | Save/restore partial artifacts | |
| 8 | Wire output-limit-handler.ts | Medium |
| | Truncate on max_tokens | |

### Files Changed

```
harness/context-window-manager.ts   (enhanced)
harness/context-compact-orchestrator.ts  (enhanced)
harness/forked-summarizer.ts      (new)
harness/continue-prompt.ts         (new)
packages/types/src/runtime-types.ts  (added ContextWindowUpdate)
```

---

## Implementation Status (2026-07-10) — FINAL UPDATE

### ✅ All Phases Complete

| Phase | Component | Status |
|-------|-----------|--------|
| **1** | `context-window-manager.ts` enhanced | ✅ Complete |
| | - `AUTOCOMPACT_BUFFER_TOKENS = 13,000` | ✅ |
| | - `MAX_CONSECUTIVE_COMPACT_FAILURES = 3` circuit breaker | ✅ |
| | - `estimateTokensWithBuffer()` with utilization | ✅ |
| | - `shouldProactiveCompact()` / `shouldBlockApiCall()` | ✅ |
| | - `recordCompactFailure()` / `recordCompactSuccess()` | ✅ |
| | - `microcompactToolResults()` helper | ✅ |
| | - `parseTokenGapFromError()` for PTL errors | ✅ |
| **2** | `forked-summarizer.ts` | ✅ New file |
| | - `ForkedSummarizer` class | ✅ |
| | - `summarize()` with keepRecentCount | ✅ |
| | - `heuristicSummary()` fallback | ✅ |
| | - `createForkedSummarizer()` factory | ✅ |
| **3** | `context-compact-orchestrator.ts` enhanced | ✅ Complete |
| | - Integrated ContextWindowManager | ✅ |
| | - Circuit breaker logic | ✅ |
| | - `onPreCompact` / `onPostCompact` callbacks | ✅ |
| | - Integrated ContinuePromptGenerator | ✅ |
| | - `isContextTooLongError()` detection | ✅ |
| **4** | `session-memory.ts` | ✅ New file |
| | - `SessionMemoryManager` class | ✅ |
| | - `extractFacts()` from messages | ✅ |
| | - `recordDecision()` / `recordFact()` | ✅ |
| | - `addFileReference()` / `addTestResult()` | ✅ |
| | - `getMemoryForContext()` for re-injection | ✅ |
| | - `createSessionMemoryManager()` factory | ✅ |
| **5** | `continue-prompt.ts` | ✅ New file |
| | - `ContinuePromptGenerator.generate()` | ✅ |
| | - `generateMinimal()` for quick resume | ✅ |
| | - `generateBoundary()` for message history | ✅ |
| **6** | `loop-runtime.ts` enhanced | ✅ Complete |
| | - Integrated CompactOrchestrator | ✅ |
| | - `executeTaskWithCompact()` with retry loop | ✅ |
| | - Session memory extraction integration | ✅ |
| | - Auto-compact event persistence | ✅ |
| | - `resumeFromCheckpoint()` support | ✅ |
| **7** | `partial-recovery.ts` enhanced | ✅ Complete |
| | - `saveFromCompact()` for compact results | ✅ |
| | - `generateContinuePrompt()` integration | ✅ |
| | - `createPartialRecovery()` factory | ✅ |

### Files Changed

```
harness/context-window-manager.ts       (enhanced)
harness/context-compact-orchestrator.ts  (enhanced)
harness/auto-compact.ts              (enhanced)
harness/loop-runtime.ts              (enhanced)
harness/partial-recovery.ts         (enhanced)
harness/forked-summarizer.ts        (NEW)
harness/continue-prompt.ts          (NEW)
harness/session-memory.ts           (NEW)
harness/index.ts                   (exports updated)
packages/types/src/runtime-types.ts  (added ContextWindowUpdate)
```

### Architecture Summary

```
LoopRuntime
  └─> executeTaskWithCompact()
        ├─> SessionMemoryManager.getMemoryForContext() — inject session context
        │
        ├─> CompactOrchestrator.invokeWithCompact()
        │     ├─> ContextWindowManager.estimateTokensWithBuffer()
        │     ├─> shouldCircuitBreak() check
        │     ├─> microcompactToolResults() — prune old tool results
        │     ├─> runFullCompact()
        │     │     ├─> ForkedSummarizer.summarize() OR heuristic
        │     │     ├─> ContinuePromptGenerator.generateBoundary()
        │     │     └─> preserveRecentToolResults()
        │     └─> ContinuePromptGenerator.generateMinimal()
        │
        ├─> onPreCompact / onPostCompact callbacks
        │     ├─> PartialRecovery.saveFromCompact()
        │     ├─> AutoCompactEngine.saveCompactionArtifact()
        │     └─> SessionMemoryManager.extractFacts()
        │
        └─> Retry loop — retry after compact if needed

AutoResume Flow:
  1. Compact triggered → summarize old messages
  2. Generate continue prompt with summary
  3. Save partial artifacts
  4. Append continue message to messages
  5. Retry LLM call with compacted context
  6. On success → extract facts to session memory
```

### Usage Example

```typescript
import {
  LoopRuntime,
  createSessionMemoryManager,
  createForkedSummarizer,
} from "./harness/index.js";

const runtime = new LoopRuntime(
  {
    jobId: "job-123",
    requirement: "Build a web app",
  },
  {
    provider: "openai",
    summarizerModel: "gpt-4",
    contextWindowSize: 128000,
    onInvokeAgent: async (opts) => {
      // Call your LLM provider
      return callLLM(opts);
    },
    onPickTask: async () => {
      return { id: "task-1", description: "..." };
    },
    onCompaction: (result) => {
      console.log("Compacted:", result.summary);
    },
  }
);

const result = await runtime.run();
console.log("Done:", result.totalCompactions, "compactions");
```
