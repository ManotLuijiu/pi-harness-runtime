# RFC-0109 — Cookie Sanitizer

## Purpose

Provider-agnostic cookie file normalization for LLM API authentication.

## Motivation

Different LLM providers use different cookie formats:

- Netscape HTTP Cookie File (curl, wget)
- EditThisCookie JSON export (Chrome)
- Custom JSON formats

The cookie sanitizer normalizes all formats to a canonical cache file that quota scrapers can read.

## Architecture

```
Input Formats                    Canonical Cache
─────────────────                ──────────────
Netscape format         ──┐
EditThisCookie JSON      ──┼──→  ~/.config/{provider}-cookies.txt
Custom JSON              ──┘
```

## Supported Providers

| Provider | Domains | Cache Path |
| ---------- | --------- | ------------ |
| MiniMax | api.minimax.chat | `~/.config/minimax-cookies.txt` |
| Anthropic | api.anthropic.com | `~/.config/anthropic-cookies.txt` |
| OpenAI | api.openai.com | `~/.config/openai-cookies.txt` |
| GLM | open.bigmodel.cn | `~/.config/glm-cookies.txt` |

## CookieWatcher

Live file monitoring for cookie updates:

```typescript
import { CookieWatcher } from "@pi-harness/cookie-sanitizer";

const watcher = new CookieWatcher({
  dropDir: "~/.pi-harness-runtime/cookies",
  onEvent: (event) => console.log(event),
});
watcher.start();
```

## Files

```
packages/
  cookie-sanitizer/
    src/
      index.ts           # Main exports
      parser.ts         # Multi-format parsing
      canonicalizer.ts  # Format normalization
      watcher.ts        # File monitoring
      providers/        # Provider-specific hints
```

## Acceptance Criteria

- [ ] Parses Netscape HTTP Cookie File format
- [ ] Parses EditThisCookie JSON export
- [ ] Normalizes to canonical cache format
- [ ] CookieWatcher detects file changes
- [ ] Provider-specific domain hints work
