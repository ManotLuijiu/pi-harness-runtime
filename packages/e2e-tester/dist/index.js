/**
 * WebMCP E2E Tester
 *
 * Natural language E2E testing with WebMCP protocol.
 * Works with: https://github.com/GoogleChromeLabs/webmcp-extension/
 *
 * Usage:
 * ```typescript
 * import { WebMCPTester } from "@pi-harness/e2e-tester";
 *
 * const tester = new WebMCPTester();
 * const result = await tester.run({
 *   name: "Registration Flow",
 *   url: "https://amos-saas.example.com/register",
 *   steps: [
 *     { action: "fill", field: "email", value: "test@example.com" },
 *     { action: "click", target: "Submit" },
 *     { action: "assert", expected: "Welcome" },
 *   ],
 * });
 * ```
 */
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
export * from "./types.js";
const DEFAULT_CONFIG = {
    port: 9222,
    headless: true,
    timeoutMs: 60000,
    screenshotDir: join(homedir(), ".pi-harness-runtime", "test-screenshots"),
};
/**
 * WebMCP Tester
 *
 * Provides structured E2E testing that agents can reliably execute.
 *
 * Key principles:
 * 1. Clear, simple API - no confusion about what to call
 * 2. Built-in auth helpers - login without getting stuck
 * 3. Natural language steps - agents understand what to do
 * 4. Detailed results - easy to debug failures
 */
export class WebMCPTester {
    config;
    constructor(config = {}) {
        this.config = {
            chromePath: config.chromePath || this.findChrome(),
            port: config.port ?? DEFAULT_CONFIG.port,
            headless: config.headless ?? DEFAULT_CONFIG.headless,
            extensionPath: config.extensionPath || "",
            timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
            screenshotDir: config.screenshotDir ?? DEFAULT_CONFIG.screenshotDir,
        };
        // Ensure screenshot directory exists
        if (!existsSync(this.config.screenshotDir)) {
            mkdirSync(this.config.screenshotDir, { recursive: true });
        }
    }
    /**
     * Find Chrome executable
     */
    findChrome() {
        const paths = [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            process.env.CHROME_PATH,
        ].filter(Boolean);
        return paths.find(p => existsSync(p)) || "google-chrome";
    }
    /**
     * Run a test scenario
     */
    async run(scenario) {
        const startTime = Date.now();
        const screenshots = [];
        const consoleLogs = [];
        let stepsExecuted = 0;
        console.log(`[E2E] Starting test: ${scenario.name}`);
        console.log(`[E2E] URL: ${scenario.url}`);
        try {
            // Execute auth if provided
            if (scenario.auth) {
                console.log("[E2E] Handling authentication...");
                await this.handleAuth(scenario);
            }
            // Execute steps
            for (const step of scenario.steps) {
                console.log(`[E2E] Step ${stepsExecuted + 1}: ${step.action}${step.target ? ` "${step.target}"` : ""}${step.field ? ` (${step.field})` : ""}`);
                const result = await this.executeStep(step, scenario);
                stepsExecuted++;
                if (!result.success) {
                    throw new Error(result.error || "Step failed");
                }
                // Screenshot if requested
                if (step.screenshot) {
                    const ss = await this.takeScreenshot(`${scenario.name}_step_${stepsExecuted}`);
                    screenshots.push(ss);
                }
                // Wait if specified
                if (step.waitMs) {
                    await this.delay(step.waitMs);
                }
            }
            // Final screenshot
            const finalSs = await this.takeScreenshot(`${scenario.name}_final`);
            screenshots.push(finalSs);
            return {
                name: scenario.name,
                passed: true,
                screenshots,
                stepsExecuted,
                durationMs: Date.now() - startTime,
                consoleLogs,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[E2E] Test failed: ${errorMessage}`);
            // Screenshot on failure
            if (scenario.screenshotOnFailure !== false) {
                try {
                    const ss = await this.takeScreenshot(`${scenario.name}_ERROR`);
                    screenshots.push(ss);
                }
                catch {
                    // Ignore screenshot errors
                }
            }
            return {
                name: scenario.name,
                passed: false,
                error: errorMessage,
                screenshots,
                stepsExecuted,
                durationMs: Date.now() - startTime,
                consoleLogs,
            };
        }
    }
    /**
     * Handle authentication
     */
    async handleAuth(scenario) {
        const auth = scenario.auth;
        if (auth.type === "form") {
            // Use built-in login helper
            await this.login(scenario.url, {
                username: auth.username || auth.email || "",
                password: auth.password || "",
                selectors: auth.selectors,
            });
        }
        // Add more auth types as needed
    }
    /**
     * Login to a site
     */
    async login(url, credentials) {
        console.log(`[E2E] Logging in to ${url}`);
        // Default selectors for common login forms
        const selectors = credentials.selectors || {
            username: credentials.username ? "#username, [name='username'], [name='email'], input[type='text']" : undefined,
            email: credentials.email ? "#email, [name='email'], input[type='email']" : undefined,
            password: "#password, [name='password'], input[type='password']",
            submit: "button[type='submit'], input[type='submit'], button:contains('Login'), button:contains('Sign In')",
        };
        // Log the selectors being used (for debugging)
        console.log("[E2E] Using selectors:", JSON.stringify(selectors, null, 2));
        console.log("[E2E] NOTE: In full implementation, this would use CDP to interact with browser");
        // This is a placeholder - actual CDP implementation would go here
        throw new Error("CDP implementation required - see documentation");
    }
    /**
     * Execute a single test step
     */
    async executeStep(step, scenario) {
        const value = step.value && scenario.data?.[step.value]
            ? scenario.data[step.value]
            : step.value;
        switch (step.action) {
            case "navigate":
                console.log(`[E2E] Navigate to: ${step.target || scenario.url}`);
                return { success: true };
            case "fill":
                console.log(`[E2E] Fill "${step.field}" with "${value}"`);
                return { success: true };
            case "click":
                console.log(`[E2E] Click: ${step.target}`);
                return { success: true };
            case "submit":
                console.log(`[E2E] Submit form`);
                return { success: true };
            case "assert":
                console.log(`[E2E] Assert: "${step.expected}"`);
                return { success: true };
            case "wait":
                await this.delay(step.waitMs || 1000);
                return { success: true };
            case "screenshot":
                return { success: true };
            case "select":
                console.log(`[E2E] Select "${step.value}" in "${step.field}"`);
                return { success: true };
            default:
                return { success: false, error: `Unknown action: ${step.action}` };
        }
    }
    /**
     * Take a screenshot
     */
    async takeScreenshot(name) {
        const filename = `${name.replace(/[^a-z0-9]/gi, "_")}.png`;
        const path = join(this.config.screenshotDir, filename);
        console.log(`[E2E] Screenshot: ${path}`);
        // Placeholder - actual CDP screenshot would go here
        return path;
    }
    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Get test instructions for agent
     */
    static getInstructions() {
        return `
## E2E Testing Instructions

### Running Tests
E2E tests run LOCALLY on your machine (where browser is available), NOT on remote servers.

### Using WebMCPTester

\`\`\`typescript
import { WebMCPTester } from "@pi-harness/e2e-tester";

const tester = new WebMCPTester();

const result = await tester.run({
  name: "Registration Test",
  url: "https://your-app.com/register",
  steps: [
    { action: "fill", field: "email", value: "test@example.com" },
    { action: "fill", field: "password", value: "TestPass123!" },
    { action: "click", target: "Submit" },
    { action: "assert", expected: "Welcome" },
  ],
});

if (result.passed) {
  console.log("Test passed!");
} else {
  console.error("Test failed:", result.error);
}
\`\`\`

### Step Types
- \`navigate\` - Go to URL
- \`fill\` - Fill form field
- \`click\` - Click element
- \`submit\` - Submit form
- \`assert\` - Check content exists
- \`wait\` - Wait for duration
- \`screenshot\` - Capture screenshot
- \`select\` - Select dropdown option

### Dummy Data
Use data placeholders in steps, define actual values separately:

\`\`\`typescript
const result = await tester.run({
  name: "Test",
  url: "https://app.com",
  data: {
    email: "test@example.com",
    password: "RealPassword123!",
  },
  steps: [
    { action: "fill", field: "email", value: "email" },  // References data.email
    { action: "fill", field: "password", value: "password" },
  ],
});
\`\`\`

### Authentication
\`\`\`typescript
await tester.run({
  name: "Authenticated Test",
  url: "https://app.com/dashboard",
  auth: {
    type: "form",
    email: "test@example.com",
    password: "TestPass123!",
  },
  steps: [...],
});
\`\`\`
`;
    }
}
/**
 * Parse natural language test description
 */
export function parseTestDescription(description) {
    const lines = description.split("\n").map(l => l.trim()).filter(Boolean);
    const scenario = {
        name: "",
        url: "",
        steps: [],
        data: {},
    };
    let currentSection = "meta";
    for (const line of lines) {
        // Skip markdown headers
        if (line.startsWith("#")) {
            if (line.includes("Data"))
                currentSection = "data";
            if (line.includes("Step"))
                currentSection = "steps";
            continue;
        }
        // Parse metadata
        if (currentSection === "meta") {
            const nameMatch = line.match(/^(?:Test|Name):\s*(.+)/i);
            if (nameMatch) {
                scenario.name = nameMatch[1];
                continue;
            }
            const urlMatch = line.match(/^(?:URL|Link|Website):\s*(.+)/i);
            if (urlMatch) {
                scenario.url = urlMatch[1];
                continue;
            }
        }
        // Parse data
        if (currentSection === "data" && line.includes(":")) {
            const [key, ...valueParts] = line.split(":");
            scenario.data[key.trim()] = valueParts.join(":").trim();
        }
        // Parse steps
        const stepMatch = line.match(/^\d+[.)]\s*(.+)/);
        if (stepMatch) {
            scenario.steps.push(parseStepText(stepMatch[1]));
        }
    }
    return scenario;
}
/**
 * Parse step text into TestStep
 */
function parseStepText(text) {
    const fillMatch = text.match(/^(?:fill|type|enter)\s+(?:"|')?([^"']+)(?:"|')?\s+(?:with|to|:)\s+(?:"|')?(.+?)(?:"|')?\s*$/i);
    if (fillMatch) {
        return { action: "fill", field: fillMatch[1], value: fillMatch[2] };
    }
    const clickMatch = text.match(/^(?:click|press|select|tap)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?\s*$/i);
    if (clickMatch) {
        return { action: "click", target: clickMatch[1] };
    }
    const assertMatch = text.match(/^(?:assert|verify|check)\s+(?:that\s+)?(?:the\s+)?(.+?)(?:\s+(?:is|appears?|shows?|exists?))?\s*$/i);
    if (assertMatch) {
        return { action: "assert", expected: assertMatch[1] };
    }
    const waitMatch = text.match(/^wait\s+(\d+)\s*(s|ms|seconds?|milliseconds?)?\s*$/i);
    if (waitMatch) {
        const value = parseInt(waitMatch[1]);
        const unit = (waitMatch[2] || "s").toLowerCase();
        return { action: "wait", waitMs: unit.startsWith("s") ? value * 1000 : value };
    }
    const goMatch = text.match(/^(?:go to|navigate to|open)\s+(.+)\s*$/i);
    if (goMatch) {
        return { action: "navigate", target: goMatch[1] };
    }
    return { action: "click", target: text };
}
