# Provider Usage API Research

**Date:** 2026-07-06  
**Updated:** Unified TUI Integration

---

## Summary: Unified TUI Message Parsing

All providers (except MiniMax) report quota exhaustion via TUI in pi.dev. No API keys needed!

| Provider | Method | File | Status |
| ---------- | -------- | ------ | -------- |
| OpenAI (GPT) | TUI message | `tui-usage-monitor.ts` | ✅ |
| GLM (Zhipu) | TUI message | `tui-usage-monitor.ts` | ✅ |
| Anthropic (Claude) | TUI message | `tui-usage-monitor.ts` | ✅ |
| OpenRouter | TUI message | `tui-usage-monitor.ts` | ✅ |
| MiniMax | Browser scraping | `minimax-browser-auth.ts` | 🔄 |

---

## Architecture

### Unified TUI Usage Monitor

**File:** `packages/quota-manager/tui-usage-monitor.ts`

The `TUIUsageMonitor` handles all TUI-based providers:

- Detects provider from message content
- Parses reset time and limit type
- Records to QuotaManager automatically

### Integration

```typescript
import { QuotaManager, TUIUsageMonitor } from "@pi-harness/quota-manager";

const quotaManager = new QuotaManager();

const monitor = new TUIUsageMonitor({
  quotaManager,
  debug: true,
});

// Hook into pi
pi.on("error", (event) => monitor.processMessage(event.message));
pi.on("message", (event) => monitor.processMessage(event.message));

// Check availability
if (!quotaManager.isAvailable("openai")) {
  const waitTime = quotaManager.getWaitTime("openai");
  console.log(`Waiting ${waitTime}ms for OpenAI`);
}
```

### Detected Patterns

| Provider | Patterns |
| ---------- | ---------- |
| OpenAI | `OpenAI`, `GPT`, `insufficient_quota`, `429` |
| GLM | `GLM`, `Zhipu`, `tokens exhausted` |
| Anthropic | `Claude`, `Anthropic`, `rate_limit_error` |
| OpenRouter | `OpenRouter`, `quota exhausted` |

---

## MiniMax (Separate)

**File:** `packages/auth/src/minimax-browser-auth.ts`

MiniMax requires browser scraping because it doesn't expose usage via TUI.

**Solution:** Local Browser Agent (RFC-0023 + RFC-0024)

---

## Files Created/Updated

```
packages/
├── quota-manager/
│   ├── quota-manager.ts       # Core quota tracking
│   ├── tui-usage-monitor.ts  # ✅ NEW - Unified TUI parser
│   ├── index.ts               # ✅ NEW - Exports
│   └── examples/
│       └── tui-usage-integration.ts  # ✅ NEW - Example
├── providers/
│   ├── openai-usage.ts       # Legacy (can be removed)
│   └── glm-usage.ts          # Legacy (can be removed)
packages/
└── types/src/
    └── runtime-types.ts       # Updated QuotaSignal.source
```

---

## TODO

### ✅ Completed

1. [x] TUIUsageMonitor - unified parser
2. [x] QuotaManager integration
3. [x] Multi-provider support

### 🔄 In Progress

4. [ ] Test with actual pi TUI messages
2. [ ] Add to pi extension

### 📋 MiniMax

- Browser scraping exists but not 100%
- Needs Local Browser Agent (RFC-0023)
- Not blocking TUI providers
