# E2E Tester - Agent-Friendly Testing

## Purpose
Simple E2E testing that agents can reliably use without confusion.

## Key Rules for Agents

### ALWAYS RUN LOCALLY
```
⚠️ IMPORTANT: E2E tests MUST run on LOCAL machine (your laptop/desktop), NOT on remote servers.
- Remote servers typically have no browser installed
- Use ctx_execute to run tests locally
- Never try to run Playwright on SSH to a server
```

### Test Location
```
Local machine: /home/frappe/amos-saas/  (or wherever the app is)
Remote server: SSH frappe@217.216.37.251  (NO BROWSER - DO NOT RUN TESTS HERE)
```

## Quick Start

```typescript
import { E2ETester } from "@pi-harness/e2e-tester";

const tester = new E2ETester({
  browser: "chromium",  // chromium, firefox, webkit
  headless: true,       // true for CI, false for debugging
});

await tester.start();

try {
  // Login first
  await tester.login("https://your-app.com/login", {
    email: "test@example.com",
    password: "TestPass123!",
  });
  
  // Navigate and test
  await tester.goto("https://your-app.com/dashboard");
  await tester.click("Submit Button");
  await tester.fill("Email", "user@example.com");
  await tester.assertVisible("Welcome");
  
} finally {
  await tester.stop();
}
```

## Natural Language Test Format

Create test files like `test-register.md`:

```markdown
# Registration Flow Test

URL: https://your-app.com/register

Auth:
  email: test@example.com
  password: TestPass123!

Steps:
1. Fill email with "test@example.com"
2. Fill password with "TestPass123!"
3. Click Submit button
4. Wait 2 seconds
5. Assert "Welcome" message is visible
6. Assert URL contains "/dashboard"

Expected:
  - Success message appears
  - Redirects to dashboard
  - No console errors
```

## Running Tests

```bash
# Run single test
bun scripts/run-e2e-test.ts --scenario test-register.md

# Run all tests
bun scripts/run-e2e-test.ts --scenario ./tests/

# With screenshots
bun scripts/run-e2e-test.ts --scenario test.md --screenshots --output ./test-output
```

## Troubleshooting

### "Cannot find browser"
```bash
# Install browsers
npx playwright install chromium
```

### "Login failed"
```typescript
// Check if login form selectors are correct
await tester.debug();  // Opens browser in non-headless mode

// Or provide custom selectors
await tester.login(url, {
  selectors: {
    email: "#email-input",
    password: "[name='password']",
    submit: "button[type='submit']",
  }
});
```

### "Test running on server"
```
STOP! You are trying to run E2E tests on a remote server.
E2E tests MUST run locally where a browser is available.

Use ctx_execute to run tests on your LOCAL machine.
```

## Architecture

```
┌─────────────────┐
│  Test Scenario  │  ← Markdown or TypeScript
│   (Natural)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  E2E Tester     │  ← Parses and executes
│  (Playwright)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Local Browser  │  ← Chromium/Firefox/WebKit
│  (Your Machine) │
└─────────────────┘
```
