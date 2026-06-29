---
name: harness-runtime
description: Show Codex-style /usage status for pi — local token tracking + manual provider mirror. Use when the user asks about token usage, API quota, 5h limit, weekly limit, or wants to know how much they've spent.
---

# pi-harness-runtime

Codex-style `/usage` slash command for pi coding agent.

## When to use

User says:

- "show me my usage"
- "how much have I used?"
- "what's my 5h limit?"
- "weekly quota?"
- "/usage"
- "/usage sync"
- "how many tokens today?"

## Quick reference

```bash
/usage         # full status (model, local tracking, provider mirror)
/usage sync    # open form to mirror provider-side quota
/usage today   # focused: this 5h + today (UTC)
/usage week    # focused: this week + lifetime
/usage reset   # clear provider mirror
```

## Data sources (3-source model)

1. **Local tracked** — every assistant message is logged to `~/.pi/usage-status/usage.jsonl`
   - Auto-tracked via `message_end` event
   - Contains: timestamp, model, input/output/cache tokens, cost
   - Real-time, exact, but only counts THIS pi session

2. **Provider mirror** — manually entered from `https://platform.minimax.io/console/usage`
   - Stored at `~/.pi/usage-status/mirror.json`
   - Synced via `/usage sync` form
   - Ground truth for TOTAL quota (across all clients)

3. **Derived** — burn rate, reset times, divergence
   - Local reset time = oldest request in window + window duration
   - Burn rate = mirror weekly % / elapsed days
   - Divergence warning if local tracking differs from mirror by >5%

## Files written

- `~/.pi/usage-status/usage.jsonl` — append-only usage log
- `~/.pi/usage-status/mirror.json` — manual provider mirror

Override location with `PI_USAGE_DIR` env var.

## Sample output

```
Codex-style usage status for pi
────────────────────────────────────────────────────────────────
 Model:        minimax/MiniMax-M3
 Directory:    ~/frappe-bench/apps/thai_business_suite

 ① LOCAL TRACKED (ground truth — we count this)
    This session:   $0.17 · 142k tokens · 17 requests
    This 5h:        384k tokens · 23 requests · $0.04
    This week:      1.2M tokens · 67 requests · $0.13
    Lifetime:       4592 requests · $81.61

 ② PROVIDER MIRROR (you enter from console.minimax.io)
    Last sync:      2 min ago [fresh]
    Provider:       minimax
    5h limit:       [████████░░░░░░░░░░░░] 18% left (resets in 4h 54m)
    Weekly limit:   [████████████████░░░░] 81% left (resets in 2d 13h)

 ③ LOCAL RESET TIMES (derived from your data)
    Local 5h reset:    in 3h 12m (oldest request falls out of window)
    Local week reset:  in 5d 7h (oldest request falls out of window)
    Local-vs-mirror:  -12.4% ⚠️  divergence > 5%
    Burn rate:        11.4% / day → 100% in 2.5 d
────────────────────────────────────────────────────────────────
```

## Safety properties

- **No auto-tracking of other clients** — local data is just this pi session
- **No scraping** — provider mirror is manual (5-second task)
- **No fabrication** — divergence warning if local and mirror disagree by >5%
- **Idempotent** — running `/usage` repeatedly has no side effects
- **Privacy-respecting** — all data stays on local disk

## Related

- `context-mode` provides overall session cost via `ctx_stats`
- pi's built-in footer shows model + git branch
