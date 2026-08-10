# RFC-0113 — Clipboard Integration

## Purpose

System clipboard integration with cross-device sync via GitHub Gist.

## Motivation

Agents need to:

- Copy text to system clipboard
- Sync clipboard across devices (server → Mac)
- Trigger clipboard capture via keyboard shortcut

## Architecture

```text
Copy Request -> xclip -> System Clipboard
                |
                +-> Bridge File (for terminal paste)
                +-> GitHub Gist (for cross-device sync)
```

## Components

### clipboard.ts

- Write to system clipboard via xclip
- Read from system clipboard

### copy-sync.ts

- Register keyboard shortcut (Ctrl+Shift+C)
- POST to GitHub Gist for cross-device sync
- Read from bridge file for terminal paste

## Files

See `IMPLEMENTATION/RFC-0113/FILES.md`.

## Acceptance Criteria

- [ ] Copy text to system clipboard
- [ ] Read from system clipboard
- [ ] Keyboard shortcut triggers capture
- [ ] Cross-device sync via Gist
