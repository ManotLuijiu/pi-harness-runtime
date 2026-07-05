# RFC 0023 - Local Browser Agent

## Purpose

Allow a headless server runtime to use a human-owned local browser session for authenticated provider pages such as MiniMax usage console.

## Motivation

Playwright opens a browser on the machine executing the command. A headless server cannot show a login window on the user's iMac.

MiniMax usage page requires authentication:

```text
https://platform.minimax.io/console/usage
```

## Core Rule

Authenticated browser sessions live where the human can interact with them.

## Architecture

```text
Server Runtime
  -> HTTP/RPC request
      -> Local Browser Agent on iMac
          -> Playwright persistent profile
          -> Human login if needed
          -> scrape usage/reset time
      -> return safe quota summary
```

## Local Agent API

```http
GET /health
POST /auth/minimax/start
GET /quota/minimax
POST /auth/minimax/reset
```

## Safe Response

```json
{
  "provider": "minimax",
  "authenticated": true,
  "checked_at": "2026-07-03T09:00:00+07:00",
  "usage_text_sample": "Token Plan usage ...",
  "reset_at": "2026-07-03T14:30:00+07:00"
}
```

## Security Rules

- Never return raw cookies.
- Never return localStorage.
- Bind to localhost by default.
- If remote access is needed, require VPN/Tailscale and token.
- Log only safe summaries.

## Acceptance Criteria

- Local browser agent opens MiniMax console in headed Playwright.
- Human logs in manually.
- Persistent profile is reused.
- Server receives only safe quota summary.
