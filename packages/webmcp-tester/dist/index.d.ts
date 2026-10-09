/**
 * WebMCP E2E Test Runner
 *
 * Natural language E2E testing using WebMCP protocol.
 * Agents write test scenarios in plain English, no playwright knowledge needed.
 *
 * Usage:
 * ```typescript
 * import { WebMCPTester, TestScenario } from "@pi-harness/webmcp-tester";
 *
 * const tester = new WebMCPTester({
 *   chromePath: "/path/to/chrome",
 *   headless: true
 * });
 *
 * const scenario: TestScenario = {
 *   name: "Registration Flow",
 *   url: "https://app.example.com/register",
 *   steps: [
 *     { action: "fill", field: "email", value: "test@example.com" },
 *     { action: "fill", field: "name", value: "Test User" },
 *     { action: "click", target: "Submit button" },
 *     { action: "assert", expected: "Welcome" }
 *   ]
 * };
 *
 * const result = await tester.run(scenario);
 * console.log(result.passed ? "PASS" : "FAIL");
 * ```
 */
export interface TestStep {
    /** Natural language action description */
    action: string;
    /** Target element or field */
    target?: string;
    /** Field name for fill actions */
    field?: string;
    /** Value for fill actions */
    value?: string;
    /** Expected result for assert actions */
    expected?: string;
    /** Wait time after action (ms) */
    waitMs?: number;
}
export interface TestScenario {
    /** Test name */
    name: string;
    /** Starting URL */
    url: string;
    /** Test steps */
    steps: TestStep[];
    /** Dummy data overrides */
    data?: Record<string, string>;
    /** Screenshot on failure */
    screenshotOnFailure?: boolean;
}
export interface TestResult {
    /** Test name */
    name: string;
    /** Whether test passed */
    passed: boolean;
    /** Error message if failed */
    error?: string;
    /** Screenshots captured */
    screenshots: string[];
    /** Steps executed */
    stepsExecuted: number;
    /** Time taken (ms) */
    durationMs: number;
    /** Console logs captured */
    consoleLogs: ConsoleLog[];
}
export interface ConsoleLog {
    level: "log" | "warn" | "error" | "info";
    message: string;
    timestamp: number;
}
export interface WebMCPTesterConfig {
    /** Chrome executable path */
    chromePath?: string;
    /** Chrome port for debugging */
    port?: number;
    /** Run in headless mode */
    headless?: boolean;
    /** WebMCP extension path */
    extensionPath?: string;
    /** Test timeout (ms) */
    timeoutMs?: number;
    /** Take screenshots */
    screenshots?: boolean;
    /** Screenshot output directory */
    screenshotDir?: string;
}
export declare class WebMCPTester {
    private config;
    private chromeProcess;
    private testResults;
    constructor(config?: WebMCPTesterConfig);
    /**
     * Find Chrome executable
     */
    private findChromePath;
    /**
     * Start Chrome with WebMCP extension
     */
    start(): Promise<void>;
    /**
     * Stop Chrome
     */
    stop(): Promise<void>;
    /**
     * Wait for Chrome debugging port to be ready
     */
    private waitForChrome;
    /**
     * Get WebSocket CDP endpoint
     */
    private getWebSocketUrl;
    /**
     * Run a test scenario
     */
    run(scenario: TestScenario): Promise<TestResult>;
    /**
     * Navigate to URL (simplified - actual CDP calls would be more complex)
     */
    private navigate;
    /**
     * Fill form field
     */
    private fill;
    /**
     * Click element
     */
    private click;
    /**
     * Assert content exists
     */
    private assert;
    /**
     * Take screenshot
     */
    private screenshot;
    /**
     * Get all test results
     */
    getResults(): TestResult[];
    /**
     * Clear results
     */
    clearResults(): void;
}
export interface ParsedScenario {
    name: string;
    url: string;
    steps: TestStep[];
}
/**
 * Parse natural language test description into TestScenario
 *
 * Examples:
 * ```
 * Test: Registration flow
 * URL: https://app.example.com/register
 *
 * Steps:
 * 1. Fill email with test@example.com
 * 2. Fill name with Test User
 * 3. Click Submit
 * 4. Verify "Welcome" message appears
 * ```
 */
export declare function parseNaturalLanguageTest(input: string): ParsedScenario;
export interface CLIRunnerConfig {
    scenarioFile?: string;
    outputDir?: string;
    headless?: boolean;
}
export declare function runFromCLI(config?: CLIRunnerConfig): Promise<void>;
