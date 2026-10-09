/**
 * WebMCP E2E Tester for pi-harness-runtime
 * 
 * Provides natural language E2E testing using WebMCP protocol.
 * Works with Chrome WebMCP Extension: https://github.com/GoogleChromeLabs/webmcp-extension/
 * 
 * Agent Usage:
 * ```
 * // Run E2E test on amos-saas
 * const tester = new WebMCPTester();
 * await tester.test({
 *   url: "https://amos-saas.example.com",
 *   scenario: "Test registration flow with email test@example.com",
 * });
 * ```
 */

export interface TestStep {
  /** Action to perform */
  action: "navigate" | "fill" | "click" | "submit" | "assert" | "wait" | "screenshot" | "select";
  /** Target element (CSS selector, text, or natural language) */
  target?: string;
  /** Field name for fill actions */
  field?: string;
  /** Value for fill actions */
  value?: string;
  /** Expected content for assert actions */
  expected?: string;
  /** Wait duration in milliseconds */
  waitMs?: number;
  /** Whether to capture screenshot */
  screenshot?: boolean;
}

export interface TestScenario {
  /** Test name */
  name: string;
  /** Starting URL */
  url: string;
  /** Authentication config */
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
  /** Test steps */
  steps: TestStep[];
  /** Dummy data for test */
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
  /** Console logs */
  consoleLogs: Array<{
    type: "log" | "warn" | "error" | "info";
    message: string;
    timestamp: number;
  }>;
}

export interface WebMCPTesterConfig {
  /** Chrome path */
  chromePath?: string;
  /** Debugging port */
  port?: number;
  /** Headless mode */
  headless?: boolean;
  /** WebMCP extension path */
  extensionPath?: string;
  /** Test timeout (ms) */
  timeoutMs?: number;
  /** Screenshot output dir */
  screenshotDir?: string;
}
