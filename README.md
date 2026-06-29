# Pi Harness Runtime

**Codex-style `/usage` status for pi coding agent: local token tracking + manual provider mirror.**

[![npm version](https://img.shields.io/npm/v/pi-harness-runtime?style=for-the-badge)](https://www.npmjs.com/package/pi-harness-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-macOS%20|20|Linux-blue?style=for-the-badge)]()

## Why Pi Harness Runtime

**3-Source Honest Tracking** — Codex-style `/status` for pi: local-tracked tokens + manually-mirrored provider quota + derived projections. No fake precision, no scraping, no password storage.

**Zero Config** — Works immediately. Auto-tracks every assistant message. Run `/usage sync` once a day to mirror provider quota from `https://platform.minimax.io/console/usage`.

**Local-First Privacy** — All data stays in `~/.pi/usage-status/`. No telemetry, no remote calls, no credential storage. The provider mirror is a 5-second manual entry.

**Derived Insights** — Auto-computes reset times from your data (no provider API needed), burn rate projections, local-vs-mirror divergence warnings.

## Install

```bash
pi install npm:pi-harness-runtime
```

Or install locally for development:

```bash
git clone https://github.com/ManotLuijiu/pi-harness-runtime.git
ln -s pi-harness-runtime ~/.pi/agent/extensions/pi-harness-runtime
pi reload
```

**Important**: Symlink the **directory** into `~/.pi/agent/extensions/`. Pi's loader scans that directory and reads `package.json`'s `pi.extensions` field for multi-file extensions. Don't symlink a single file (relative imports break) or symlink into `node_modules/` (pi doesn't auto-scan there).

No API keys required. No build step (Bun runs `.ts` directly).

Requires Pi v0.37.3+.

## Quick Start

```bash
/usage           # show full status (model, local tracking, provider mirror)
/usage sync      # open form to mirror provider-side quota
/usage today     # focused: today's usage + 5h window
/usage week      # focused: this week's usage + lifetime totals
/usage reset     # clear provider mirror (force re-sync)
```

## Commands

### `/usage`

Show Codex-style usage status. Renders three sections:

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

### `/usage sync`

Open a 6-prompt form to mirror provider-side quota:

```
5h used % (0-100) for minimax: [18]
5h resets in (hours): [4]
5h resets in (minutes, 0-59): [56]
Weekly used % (0-100): [72]
Weekly resets in (days, 0-7): [2]
Weekly resets in (hours, 0-23): [13]
```

Saves to `~/.pi/usage-status/mirror.json` and updates the next `/usage` output.

### `/usage today`

Focused view: today's usage + 5h window. Quick check before starting a long session.

### `/usage week`

Focused view: this week's usage + lifetime totals. Good for end-of-week review.

### `/usage reset`

Clear the provider mirror. Local usage log is preserved. Asks for confirmation.

## How It Works

### Data Sources (3-source model)

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

### Files Written

| Path | Contents |
|---|---|
| `~/.pi/usage-status/usage.jsonl` | Append-only usage log |
| `~/.pi/usage-status/mirror.json` | Manual provider mirror |
| (none — pure functions) | CLI helpers in `cli.ts` |

Override location with `PI_USAGE_DIR` env var (useful for testing).

### What's NOT Stored

- Your password (we don't ask for it, ever)
- Provider session tokens (we don't read browser cookies)
- Telemetry or remote calls (all local)
- Auto-send quota (you always confirm any sync)

## Why Manual Mirror?

Most AI providers (MiniMax, Anthropic, OpenAI) don't expose rate limit headers publicly. Two alternatives exist:

| Approach | Pros | Cons |
|---|---|---|
| **Manual mirror** (this) | Zero security risk, 5 sec/day | 1 manual entry |
| **Browser cookie extraction** (pi-web-access does for Gemini Web) | Fully automatic | ~400 LOC platform-specific code, fragile to auth changes |
| **HTML scraping** (assumes cookies work) | Once cookies extracted, parsing is easy | Breaks if page redesigns |

We chose the manual approach because:

1. MiniMax's UI shows reset times like "Resets in 4 hr 56 min" — manual entry is genuinely 5 seconds
2. Cookie extraction has ongoing maintenance burden
3. Password storage is a security anti-pattern

If you find yourself needing to sync more than 3x/day, we may add browser cookie extraction as a future enhancement.

## Safety Properties

- ✅ **No auto-tracking of other clients** — local data is just this pi session
- ✅ **No scraping** — provider mirror is manual
- ✅ **No fabrication** — divergence warning if local and mirror disagree
- ✅ **Idempotent** — running `/usage` repeatedly has no side effects
- ✅ **Privacy-respecting** — all data stays on local disk
- ✅ **No credentials stored** — passwords, tokens, cookies: none

## Architecture

```
pi-harness-runtime/
├── index.ts              # entry — exports default (pi: ExtensionAPI)
├── tracker.ts            # UsageTracker — JSONL writer/reader
├── mirror.ts             # MirrorStore — JSON read/write + freshness check
├── windows.ts            # WindowAggregator — pure aggregation functions
├── renderer.ts           # StatusRenderer — Codex-style progress bars
├── sync-form.ts          # /usage sync form handling
├── cli.ts                # shared pure helpers (paths, formatting, IO)
├── skills/
│   └── harness-runtime/
│       └── SKILL.md      # bundled skill (auto-loaded)
├── test/                 # node --test
│   ├── cli.test.mjs
│   ├── tracker.test.mjs
│   ├── mirror.test.mjs
│   ├── windows.test.mjs
│   ├── renderer.test.mjs
│   └── sync-form.test.mjs
├── package.json          # "pi" field declares extensions + skills
├── README.md
├── CHANGELOG.md
├── LICENSE               # MIT
└── .gitignore
```

## Related

- [pi-web-access](https://github.com/nicobailon/pi-web-access) — web search + URL fetching for pi (inspiration for this package's structure)
- [context-mode](https://github.com/MiniMax-AI/context-mode) — context-window tracking (complementary)
- [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) — the underlying pi agent

## License

MIT © 2026 MooCoding
