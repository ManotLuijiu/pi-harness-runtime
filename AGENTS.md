# pi-harness-runtime Agent Notes

## Authenticated SPA Content Fetching Tactic

Use this tactic when a user asks an agent to read authenticated web console pages, dashboards, or usage pages rendered by a JavaScript SPA.

### Key lesson

A cookie-backed `curl` request may successfully return HTTP 200 but still only fetch the static HTML / Next.js shell. The real data is often loaded after page load by browser JavaScript through API calls.

Example verified page:

```text
https://platform.minimax.io/console/usage?cycle_type=1
```

For this page, raw cookie-backed fetch returned the shell, while headless Playwright/Chrome with injected cookies successfully loaded the visible usage data and API responses.

## Successful tactic

1. Use the user-provided Netscape-format cookie file.
2. Never print raw cookie contents.
3. Launch headless Playwright/Chrome.
4. Inject cookies into the browser context.
5. Navigate to the authenticated URL.
6. Wait for DOM content, then network idle or a short settle delay.
7. Extract visible `body.innerText`.
8. Capture API responses whose URLs contain terms like:
   - `api`
   - `usage`
   - `billing`
   - `quota`
   - `consumption`
   - `recharge`
   - `resource`
   - `plan`
   - `subscription`
9. Redact tokens, API keys, cookies, authorization headers, JWTs, and session-like values before reporting.

## Python Playwright skeleton

```python
import asyncio
import json
import pathlib
import re
from playwright.async_api import async_playwright

COOKIE_FILE = "/path/to/domain_cookies.txt"
URL = "https://example.com/console/usage"


def load_netscape_cookies(path):
    cookies = []
    for line in pathlib.Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line or (line.startswith("#") and not line.startswith("#HttpOnly_")):
            continue
        http_only = False
        if line.startswith("#HttpOnly_"):
            http_only = True
            line = line[len("#HttpOnly_"):]
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        domain, _flag, cookie_path, secure, expires, name, value = parts[:7]
        cookie = {
            "name": name,
            "value": value,
            "domain": domain,
            "path": cookie_path or "/",
            "secure": secure.upper() == "TRUE",
            "httpOnly": http_only,
        }
        try:
            if int(expires) > 0:
                cookie["expires"] = int(expires)
        except Exception:
            pass
        cookies.append(cookie)
    return cookies


def redact(text):
    text = re.sub(
        r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}",
        "[JWT_REDACTED]",
        text,
    )
    text = re.sub(
        r"(?i)(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|session|secret)(\"?\s*[:=]\s*\"?)[^\",}\s]+",
        r"\1\2[REDACTED]",
        text,
    )
    text = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9._-]+", r"\1[REDACTED]", text)
    return text


async def main():
    captured = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            locale="en-US",
            viewport={"width": 1440, "height": 1000},
        )
        await context.add_cookies(load_netscape_cookies(COOKIE_FILE))
        page = await context.new_page()

        async def on_response(resp):
            url = resp.url
            if any(
                term in url.lower()
                for term in [
                    "api",
                    "usage",
                    "billing",
                    "quota",
                    "consumption",
                    "recharge",
                    "resource",
                    "plan",
                    "subscription",
                ]
            ):
                item = {
                    "url": url,
                    "status": resp.status,
                    "content_type": resp.headers.get("content-type", ""),
                }
                try:
                    body = await resp.text()
                    item["body_preview"] = redact(body[:2000])
                except Exception as exc:
                    item["body_error"] = str(exc)
                captured.append(item)

        page.on("response", on_response)
        await page.goto(URL, wait_until="domcontentloaded", timeout=90000)
        try:
            await page.wait_for_load_state("networkidle", timeout=45000)
        except Exception:
            pass
        await page.wait_for_timeout(5000)

        print("TITLE:", await page.title())
        print("URL:", page.url)
        print("VISIBLE_TEXT:")
        print(redact(await page.locator("body").inner_text(timeout=10000)))
        print("CAPTURED_API_RESPONSES:", len(captured))
        for item in captured:
            print(json.dumps(item, ensure_ascii=False)[:3000])

        await browser.close()

asyncio.run(main())
```

## MiniMax-specific observed endpoints

For the MiniMax usage page, useful API responses were observed from:

```text
https://platform.minimax.io/v1/api/openplatform/charge/token_plan/usage
https://platform.minimax.io/backend/account/token_plan_credit
```

## Example output to return

When the page is successfully read, summarize the useful visible data in a concise section like this:

```markdown
### Visible usage content found

- Current subscription: Token Plan · Monthly Plus
- Current month: July
- My usage:
  - 5h limit
  - Resets in 1 hr 27 min
  - Used 71%
- Weekly limit:
  - Resets in 2 days 15 hr
  - Used 46%
- Credit balance:
  - No credits yet
- Usage details:
  - 201.23M tokens around 10 Jul 08:00 UTC
  - 1.68B last 7 days
  - 3.51B last 30 days
  - 11.22B total tokens
  - 295.17M peak tokens
  - 103 active days
```

Guidelines for this section:

- Return visible/account usage facts the user cares about, not raw HTML.
- Keep sensitive fields redacted, especially API keys, tokens, cookies, and session IDs.
- Include the source page title and URL separately when useful.
- Mention captured API endpoints only if they help explain where the data came from.

## Safety rules

- Never print raw cookie files.
- Never print full request headers if they include cookies or authorization.
- Redact JWTs, API keys, bearer tokens, session IDs, and cookie values.
- Prefer `/tmp/` for temporary HTML, bundle, or response captures.
- If the user provides cookies, use them only for the requested domain and task.
