# @pi-harness/cookie-sanitizer

> Forgiving input → strict canonical cache for provider-quota mirroring.

A normalization boundary that lets users drop **any** cookie file (any name, any format) into a known folder, and turns it into a single standard Netscape file the rest of the runtime can rely on.

```
~/.pi-harness-runtime/cookies/          ← user drops anything here
            │
            ▼
   Cookie Sanitizer                     ← THIS PACKAGE
            │
            ▼
~/.config/<provider>-cookies.txt        ← canonical, runtime-owned
            │
            ▼
   MiniMaxQuotaScraper (unchanged)      ← reads only the canonical
```

## Why

The previous design expected users to know the exact path (`~/.config/minimax-cookies.txt`) and the exact format (Netscape). On a fresh machine, no-one ever set this up — the scraper silently no-op'd and the footer lost its `5h:` / `week:` lines. This package is the discoverable, forgiving adapter between messy human input and the clean contract downstream code already understands.

## What it accepts

**Input formats** (auto-detected per file):

1. **Netscape HTTP Cookie File** — the canonical format
2. **EditThisCookie / Chrome devtools JSON export** — array of records in the Chrome/Edge cookie store shape

**File names** — any name in the drop folder. Inference prefers:

1. Filename hint (`minimax-*.txt`, `*claude*`, etc.) → provider
2. Dominant cookie domain (≥ 80% match) → provider
3. `providerHint` option overrides all of the above

**Provider scope** — currently shipping with: `minimax`, `anthropic`, `openai`, `glm`, `openrouter`. The registry is open and inference by domain works for any provider whose cookies are in the drop folder.

## Usage

### One-shot sync

```typescript
import { sync } from "@pi-harness/cookie-sanitizer";

const result = sync();

if (result.wrote) {
  console.log(`Synced ${result.totalCookies} cookies for ${result.provider} → ${result.cachePath}`);
} else {
  console.log(`No-op: ${result.errors[0]?.message ?? "nothing to sync"}`);
}
```

### Live watcher

```typescript
import { CookieWatcher } from "@pi-harness/cookie-sanitizer";

const watcher = new CookieWatcher({
  dropDir: "~/.pi-harness-runtime/cookies",
  onEvent: (e) => {
    if (e.kind === "sync-ok") console.log(`Synced ${e.cookies} cookies → ${e.cachePath}`);
    if (e.kind === "sync-error") console.error(`Sync error: ${e.message}`);
  },
});

watcher.start();
// ... later
await watcher.stop();
```

### Custom drop folder / cache path

```typescript
import { sync } from "@pi-harness/cookie-sanitizer";

const result = sync({
  dropDir: "/var/spool/cookies",
  cachePath: "/var/spool/canonical/minimax-cookies.txt",
  providerHint: "minimax", // skip inference
});
```

## Storage contract

| Path | Owned by | Mode | Format |
|---|---|---|---|
| `~/.pi-harness-runtime/cookies/` | user (writes freely) | `0o644` | anything |
| `~/.config/<provider>-cookies.txt` | sanitizer (single writer) | `0o600` | standard Netscape |

The sanitizer is the **only** writer of the canonical cache. Manual edits are overwritten on next sync — by design. If you want a manual override, set `QUOTA_COOKIE_FILE` env var to a different path; the sanitizer will then skip its work and the scraper reads the override directly.

## What is NOT logged

- Cookie **values** — never. Diagnostics use file basenames and 64-char previews with values redacted.
- Cookie **paths** (except the canonical cache path, which is a configuration location).
- Cookie **domains** are OK to print (public).

## Tests

```bash
bun test                 # all package tests
bun test test/parse.test.ts
bun test test/sync.test.ts
```

## Security

- The canonical cache is `0o600` (owner R/W only) — atomic write with `0o600` parent, `fsync` before `rename`, `chmod` to `0o600` after rename.
- The drop folder is gitignored by convention (`.gitleaks.toml` allowlists `cookies.txt` files in both locations).
- `chokidar` v5 watches the drop folder; sandboxed to `depth: 2` so we don't follow symlinks into the rest of the home directory.

## Files

```
src/
├── index.ts            # public API surface
├── types.ts            # canonical types
├── detect-format.ts    # Netscape vs JSON detection
├── parse-netscape.ts   # Netscape parser + serializer
├── parse-json.ts       # EditThisCookie JSON parser
├── normalize.ts        # dedupe, expire, domain-match
├── infer-provider.ts   # filename + domain inference
├── atomic-write.ts     # POSIX atomic write
├── sync.ts             # orchestrator
└── watcher.ts          # chokidar v5 wrapper

test/
├── parse.test.ts       # 14 cases — Netscape + JSON
├── normalize.test.ts   # 12 cases — dedupe/expire/domain
├── infer.test.ts       # 13 cases — filename + domain + combined
├── sync.test.ts        # 12 cases — end-to-end
└── watcher.test.ts     # 2 cases — config sanity (chokidar is exercised live)
```

## Limitations

- Watcher tests are light-touch (chokidar needs a real OS-level fs watcher). Real behavior is exercised by the live runtime.
- Multi-format inputs (e.g. raw `Cookie:` headers, single-line `k=v`) are deferred. Add on demand.
- Provider scope is currently hard-coded to a small set. Adding a new provider = adding an entry in `infer-provider.ts`.
