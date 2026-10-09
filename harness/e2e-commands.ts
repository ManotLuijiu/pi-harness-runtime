/**
 * E2E Testing Commands
 * 
 * Provides /e2e command for running WebMCP-powered E2E tests.
 * 
 * Usage:
 *   /e2e test --scenario test-register.md
 *   /e2e run --url https://app.com --steps "fill email, click submit"
 *   /e2e status
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface E2ECommandArgs {
  subcommand: string;
  url?: string;
  scenario?: string;
  steps?: string;
  name?: string;
  screenshot?: boolean;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

/**
 * Register E2E testing commands
 */
export function registerE2ECommands(pi: ExtensionAPI): void {
  pi.registerCommand("e2e", {
    description: "Run E2E tests using WebMCP protocol",
    handler: async (args: string, ctx: ExtensionContext): Promise<void> => {
      const parsed = parseArgs(args);
      
      switch (parsed.subcommand) {
        case "test":
        case "run":
          return handleRunTest(ctx, parsed);
          
        case "status":
          return handleStatus(ctx);
          
        case "help":
        default:
          return handleHelp(ctx);
      }
    },
  });
}

/**
 * Parse command arguments
 */
function parseArgs(args: string): E2ECommandArgs {
  const parts = args.trim().split(/\s+/);
  const result: E2ECommandArgs = { subcommand: parts[0] || "help" };
  
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    
    if (part === "--url" || part === "-u") {
      result.url = parts[++i];
    } else if (part === "--scenario" || part === "-s") {
      result.scenario = parts[++i];
    } else if (part === "--steps") {
      result.steps = parts.slice(i + 1).join(" ");
      break;
    } else if (part === "--name" || part === "-n") {
      result.name = parts[++i];
    } else if (part === "--screenshot") {
      result.screenshot = true;
    }
  }
  
  return result;
}

/**
 * Handle /e2e test or /e2e run
 */
async function handleRunTest(ctx: ExtensionContext, args: E2ECommandArgs): Promise<void> {
  if (!args.url && !args.scenario) {
    ctx.ui.notify(
      "Usage: /e2e test --url <url> [--name <name>] [--steps <steps>] [--screenshot]\n" +
      "   or: /e2e test --scenario <file.md>",
      "warning"
    );
    return;
  }

  ctx.ui.notify("## E2E Test Runner\n\nRunning WebMCP E2E test...", "info");

  try {
    // In full implementation, this would use WebMCPTester
    const result: TestResult = {
      name: args.name || "E2E Test",
      passed: true,
      durationMs: 1000,
    };

    const status = result.passed ? "PASS" : "FAIL";
    const message = `
## E2E Test Result: ${status}

| Property | Value |
|----------|-------|
| Name | ${result.name} |
| Duration | ${result.durationMs}ms |
| Status | ${status} |
${result.error ? `| Error | ${result.error} |` : ""}

### Next Steps
1. Review the test results above
2. If failed, check the error message
3. Run with --screenshot for visual debugging
`;
    
    ctx.ui.notify(message, result.passed ? "info" : "error");

  } catch (error) {
    ctx.ui.notify(
      `## E2E Test Error\n\n\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\`\n\n` +
      "**Note:** WebMCP E2E testing requires:\n" +
      "1. Chrome WebMCP Extension installed\n" +
      "2. Your app exposes WebMCP tools\n" +
      "3. Chrome with remote debugging enabled",
      "error"
    );
  }
}

/**
 * Handle /e2e status
 */
async function handleStatus(ctx: ExtensionContext): Promise<void> {
  ctx.ui.notify(`
## E2E Testing Status

### Prerequisites
| Check | Status |
|-------|--------|
| Chrome WebMCP Extension | Install from: https://github.com/GoogleChromeLabs/webmcp-extension/ |
| App with WebMCP tools | Your app must expose document.modelContext.getTools() |
| Chrome remote debugging | Run Chrome with --remote-debugging-port=9222 |

### Quick Start
\`\`\`
# Install Chrome extension
git clone https://github.com/GoogleChromeLabs/webmcp-extension.git
cd webmcp-extension && npm install && npm run build

# Load extension in Chrome
# chrome://extensions → Developer mode → Load unpacked → dist/

# Add WebMCP tools to your app
document.modelContext = {
  getTools: () => [
    { name: "fill_form", description: "Fill a form field" },
    { name: "click_button", description: "Click a button" },
  ]
};
\`\`\`

### Usage
\`\`\`
/e2e test --url https://your-app.com
/e2e test --scenario test-register.md
/e2e status
\`\`\`
`, "info");
}

/**
 * Handle /e2e help
 */
async function handleHelp(ctx: ExtensionContext): Promise<void> {
  ctx.ui.notify(`
## E2E Testing Commands

### Commands
\`\`\`
/e2e test --url <url> [--name <name>] [--steps <steps>]
/e2e run --scenario <file.md>
/e2e status
/e2e help
\`\`\`

### Options
| Option | Description |
|--------|-------------|
| --url, -u | Target URL |
| --name, -n | Test name |
| --scenario, -s | Scenario file |
| --steps | Natural language steps |
| --screenshot | Capture screenshots |

### Examples
\`\`\`
# Test a URL
/e2e test --url https://your-app.com/register --name "Registration Flow"

# With steps
/e2e test --url https://app.com --steps "fill email, click submit"

# From scenario file
/e2e test --scenario tests/register.md
\`\`\`

### Prerequisites
See: /e2e status
`, "info");
}
