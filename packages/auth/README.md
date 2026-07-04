# Auth Package

Safe browser authentication for pi-harness-runtime.

## Purpose

Provides a secure way to authenticate with provider websites (like MiniMax) using a Playwright-managed browser profile. The human owns the authentication - the agent never sees credentials.

## Security Rules

- Human logs in manually in the browser
- No username, password, raw cookies, or session tokens stored
- Only a safe status file is written
- Agent can only check if authentication succeeded

## Files

- `src/minimax-browser-auth.ts` - Main auth module
- `src/run-minimax-auth.ts` - CLI runner

## Usage

```bash
# Authenticate (opens browser for manual login)
bun packages/auth/src/run-minimax-auth.ts auth

# Check authentication status
bun packages/auth/src/run-minimax-auth.ts check
```

## Storage

- **Browser profile**: `~/.pi-harness-runtime/browser-profiles/minimax/`
- **Status file**: `~/.pi-harness-runtime/auth/minimax-auth-status.json`

## Status File Format

```json
{
  "provider": "minimax",
  "authenticated": true,
  "checked_at": "2026-07-04T08:00:00.000Z",
  "page_url": "https://platform.minimax.io/console/usage",
  "detected_text_sample": "Usage Plan Credits Reset"
}
```

## What is NOT stored

- Passwords
- Raw cookies
- Session tokens
- LocalStorage values
- API keys

## Limitations

- Requires a display (headed browser mode)
- Works on Mac/Linux with display
- Cannot run in truly headless environments without Xvfb
