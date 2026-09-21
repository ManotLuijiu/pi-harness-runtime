# Quota Scraping - Authentication Guide

## Overview

This project now supports quota scraping from multiple providers with different authentication methods:

| Provider   | Auth Method      | Status | Notes                          |
|------------|----------------|--------|--------------------------------|
| MiniMax    | Browser cookies | ✅     | Works with cookie files         |
| GLM / z.ai | API Key        | ✅     | Requires `~/.pi-harness-runtime/keys/zai-api-key.txt` |
| ChatGPT    | OAuth tokens   | ✅     | Requires `~/.codex/auth.json`   |
| Codex      | OAuth tokens   | ✅     | Uses ChatGPT endpoint          |
| OpenAI     | Browser cookies | ✅     | Cookie-based scraping          |

## Setup

### 1. MiniMax (Browser Cookies)

Cookies from Chrome/Chromium work for MiniMax:

```bash
# Export cookies using EditThisCookie or Chrome DevTools
# Save as: ~/.config/minimax-cookies.txt (Netscape format)
```

### 2. GLM / z.ai (API Key)

```bash
# Create keys directory
mkdir -p ~/.pi-harness-runtime/keys

# Add your z.ai API key
echo "your-api-key-here" > ~/.pi-harness-runtime/keys/zai-api-key.txt
```

API endpoint: `https://api.z.ai/api/monitor/usage/model-usage`

### 3. ChatGPT / Codex (OAuth)

ChatGPT and Codex use the same OAuth authentication:

```bash
# Codex stores tokens at ~/.codex/auth.json
# The scraper will automatically refresh expired tokens
```

## Usage

### JavaScript API

```typescript
import {
  UnifiedQuotaManager,
  GLMQuotaManager,
  ChatGPTQuotaManager,
  MiniMaxQuotaManager,
} from './harness/e2e/index.js';

// Auto-detect provider
const manager = new UnifiedQuotaManager();
const providers = manager.getAvailableProviders();
console.log('Available:', providers);

// Get quota
const quota = await manager.getQuota();
console.log(`Usage: ${quota.usagePercent}%`);

// Direct usage
const glm = new GLMQuotaManager();
const glmQuota = await glm.getQuota();
```

### Environment Variables

```bash
# Provider selection
QUOTA_PROVIDER=glm  # minimax, glm, chatgpt, openai-codex, openai, auto

# Cookie file (for browser-based)
QUOTA_COOKIE_FILE=~/.config/minimax-cookies.txt

# API key (for API-based)
QUOTA_API_KEY_FILE=~/.pi-harness-runtime/keys/zai-api-key.txt
QUOTA_API_KEY=sk-...  # Direct key

# OAuth auth file
QUOTA_AUTH_FILE=~/.codex/auth.json

# Cache duration (ms)
QUOTA_CACHE_MS=300000  # 5 minutes
```

## Browser-Based Scraping

For providers that don't expose APIs but have web dashboards:

### Codex / chatgpt.com

The existing `ChatGPTQuotaScraper` uses OAuth tokens from `~/.codex/auth.json`:

```typescript
import { ChatGPTQuotaScraper } from './harness/e2e/chatgpt-quota-scraper.js';

const scraper = new ChatGPTQuotaScraper();
const quota = await scraper.scrape();
```

### Z.ai (Browser Fallback)

If API key doesn't work, use browser-based scraping:

```typescript
import { ZaiBrowserScraper, checkZaiCookies } from './harness/e2e/browser-scrapers/index.js';

// Check if cookies are available
console.log(checkZaiCookies());

// Use browser scraper
const scraper = new ZaiBrowserScraper({ headless: true });
const result = await scraper.scrape();
```

## Troubleshooting

### Cookies don't work for automation

Some sites (like Codex) use HttpOnly/Secure cookies that can't be extracted. In this case:
- Use OAuth tokens (for Codex: `~/.codex/auth.json`)
- Use API keys (for z.ai: API endpoint)

### Browser automation blocked

If Playwright is detected and blocked:
- Use the `--disable-blink-features=AutomationControlled` flag
- Use a dedicated Chrome profile
- Try headful mode with user interaction

## Files

```
harness/e2e/
├── index.ts                      # Exports all scrapers
├── unified-quota-manager.ts       # Unified interface for all providers
├── minimax-quota-scraper.ts      # MiniMax (cookies)
├── glm-quota-scraper.ts          # GLM/z.ai (API key)
├── chatgpt-quota-scraper.ts      # ChatGPT/Codex (OAuth)
├── openai-quota-scraper.ts       # OpenAI (cookies)
└── browser-scrapers/             # Browser-based fallbacks
    ├── index.ts
    ├── chrome-profile-manager.ts
    ├── base-browser-scraper.ts
    ├── codex-browser-scraper.ts
    └── zai-browser-scraper.ts
```
