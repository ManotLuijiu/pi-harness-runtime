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
export * from "./types.js";
export interface TestStep {
    action: "navigate" | "fill" | "click" | "submit" | "assert" | "wait" | "screenshot" | "select";
    target?: string;
    field?: string;
    value?: string;
    expected?: string;
    waitMs?: number;
    screenshot?: boolean;
}
export interface TestScenario {
    name: string;
    url: string;
    auth?: {
        type: "form" | "cookie" | "token";
        username?: string;
        password?: string;
        email?: string;
        selectors?: {
            username?: string;
            email?: string;
            password?: string;
            submit?: string;
        };
    };
    steps: TestStep[];
    data?: Record<string, string>;
    screenshotOnFailure?: boolean;
}
export interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    screenshots: string[];
    stepsExecuted: number;
    durationMs: number;
    consoleLogs: Array<{
        type: "log" | "warn" | "error" | "info";
        message: string;
        timestamp: number;
    }>;
}
export interface WebMCPTesterConfig {
    chromePath?: string;
    port?: number;
    headless?: boolean;
    extensionPath?: string;
    timeoutMs?: number;
    screenshotDir?: string;
}
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
export declare class WebMCPTester {
    private config;
    constructor(config?: WebMCPTesterConfig);
    /**
     * Find Chrome executable
     */
    private findChrome;
    /**
     * Run a test scenario
     */
    run(scenario: TestScenario): Promise<TestResult>;
    /**
     * Handle authentication
     */
    private handleAuth;
    /**
     * Login to a site
     */
    login(url: string, credentials: {
        username?: string;
        email?: string;
        password: string;
        selectors?: {
            username?: string;
            email?: string;
            password?: string;
            submit?: string;
        };
    }): Promise<void>;
    /**
     * Execute a single test step
     */
    private executeStep;
    /**
     * Take a screenshot
     */
    private takeScreenshot;
    /**
     * Delay helper
     */
    private delay;
    /**
     * Get test instructions for agent
     */
    static getInstructions(): string;
}
/**
 * Parse natural language test description
 */
export declare function parseTestDescription(description: string): TestScenario;
