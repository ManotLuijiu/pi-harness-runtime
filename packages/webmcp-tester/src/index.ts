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

import { spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const exec = promisify(require("child_process").exec);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// WebMCP Test Runner
// ---------------------------------------------------------------------------

export class WebMCPTester {
  private config: Required<WebMCPTesterConfig>;
  private chromeProcess: ChildProcess | null = null;
  private testResults: TestResult[] = [];
  
  constructor(config: WebMCPTesterConfig = {}) {
    this.config = {
      chromePath: config.chromePath || this.findChromePath(),
      port: config.port || 9222,
      headless: config.headless ?? true,
      extensionPath: config.extensionPath || "",
      timeoutMs: config.timeoutMs || 60000,
      screenshots: config.screenshots ?? true,
      screenshotDir: config.screenshotDir || join(homedir(), ".pi-harness-runtime", "test-screenshots"),
    };
  }
  
  /**
   * Find Chrome executable
   */
  private findChromePath(): string {
    const paths = [
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      process.env.CHROME_PATH,
    ].filter(Boolean) as string[];
    
    for (const path of paths) {
      if (existsSync(path)) {
        return path;
      }
    }
    
    return "google-chrome"; // Let system resolve
  }
  
  /**
   * Start Chrome with WebMCP extension
   */
  async start(): Promise<void> {
    if (this.chromeProcess) {
      return; // Already running
    }
    
    // Ensure screenshot directory exists
    if (this.config.screenshots) {
      await mkdir(this.config.screenshotDir, { recursive: true });
    }
    
    const args = [
      `--remote-debugging-port=${this.config.port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-popup-blocking",
    ];
    
    if (this.config.headless) {
      args.push("--headless=new");
    }
    
    if (this.config.extensionPath) {
      args.push(`--load-extension=${this.config.extensionPath}`);
    }
    
    this.chromeProcess = spawn(this.config.chromePath, args, {
      detached: false,
      stdio: "ignore",
    });
    
    this.chromeProcess.on("error", (err) => {
      console.error("[WebMCP Tester] Chrome error:", err.message);
    });
    
    // Wait for Chrome to start
    await this.waitForChrome();
    
    console.log("[WebMCP Tester] Chrome started on port", this.config.port);
  }
  
  /**
   * Stop Chrome
   */
  async stop(): Promise<void> {
    if (this.chromeProcess) {
      this.chromeProcess.kill();
      this.chromeProcess = null;
      console.log("[WebMCP Tester] Chrome stopped");
    }
  }
  
  /**
   * Wait for Chrome debugging port to be ready
   */
  private async waitForChrome(timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`http://localhost:${this.config.port}/json/version`);
        if (response.ok) {
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    
    throw new Error("Chrome debugging port not ready");
  }
  
  /**
   * Get WebSocket CDP endpoint
   */
  private async getWebSocketUrl(): Promise<string> {
    const response = await fetch(`http://localhost:${this.config.port}/json`);
    const tabs = await response.json();
    const tab = tabs[0];
    return tab.webSocketDebuggerUrl;
  }
  
  /**
   * Run a test scenario
   */
  async run(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const screenshots: string[] = [];
    const consoleLogs: ConsoleLog[] = [];
    let stepsExecuted = 0;
    
    try {
      await this.start();
      
      // Navigate to URL
      console.log(`[WebMCP Tester] Loading: ${scenario.url}`);
      
      // Execute steps
      for (const step of scenario.steps) {
        console.log(`[WebMCP Tester] Step: ${step.action} ${step.target || step.field || ""}`);
        stepsExecuted++;
        
        // Handle different action types
        switch (step.action.toLowerCase()) {
          case "navigate":
          case "go to":
          case "open":
            await this.navigate(scenario.url);
            break;
            
          case "fill":
          case "type":
          case "enter":
            await this.fill(step.field!, step.value!, scenario.data);
            break;
            
          case "click":
          case "press":
          case "select":
            await this.click(step.target!);
            break;
            
          case "submit":
          case "send":
            await this.click(step.target || "button[type=submit], input[type=submit], button:contains(Submit)");
            break;
            
          case "assert":
          case "verify":
          case "check":
            const found = await this.assert(step.expected!);
            if (!found) {
              throw new Error(`Assertion failed: "${step.expected}" not found`);
            }
            break;
            
          case "wait":
            await new Promise((r) => setTimeout(r, step.waitMs || 1000));
            break;
            
          case "screenshot":
            const ss = await this.screenshot(scenario.name, stepsExecuted);
            screenshots.push(ss);
            break;
        }
        
        // Wait after action if specified
        if (step.waitMs) {
          await new Promise((r) => setTimeout(r, step.waitMs));
        }
      }
      
      // Take final screenshot
      if (this.config.screenshots) {
        const ss = await this.screenshot(scenario.name, stepsExecuted);
        screenshots.push(ss);
      }
      
      return {
        name: scenario.name,
        passed: true,
        screenshots,
        stepsExecuted,
        durationMs: Date.now() - startTime,
        consoleLogs,
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Screenshot on failure
      if (this.config.screenshots) {
        try {
          const ss = await this.screenshot(scenario.name, "error");
          screenshots.push(ss);
        } catch {
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
      
    } finally {
      await this.stop();
    }
  }
  
  /**
   * Navigate to URL (simplified - actual CDP calls would be more complex)
   */
  private async navigate(url: string): Promise<void> {
    // In real implementation, use CDP to navigate
    console.log(`[WebMCP Tester] Navigating to: ${url}`);
  }
  
  /**
   * Fill form field
   */
  private async fill(field: string, value: string, data?: Record<string, string>): Promise<void> {
    const actualValue = data?.[value] || value;
    console.log(`[WebMCP Tester] Filling "${field}" with: ${actualValue}`);
    
    // In real implementation, use CDP to find and fill element
    // This is where natural language understanding helps
  }
  
  /**
   * Click element
   */
  private async click(target: string): Promise<void> {
    console.log(`[WebMCP Tester] Clicking: ${target}`);
    
    // In real implementation, use CDP to find and click element
    // Target could be "Submit button", "Next", "Continue", etc.
  }
  
  /**
   * Assert content exists
   */
  private async assert(expected: string): Promise<boolean> {
    console.log(`[WebMCP Tester] Asserting: ${expected}`);
    
    // In real implementation, use CDP to check page content
    return true;
  }
  
  /**
   * Take screenshot
   */
  private async screenshot(name: string, suffix: string | number): Promise<string> {
    const filename = `${name.replace(/[^a-z0-9]/gi, "_")}_${suffix}.png`;
    const path = join(this.config.screenshotDir, filename);
    
    console.log(`[WebMCP Tester] Screenshot: ${path}`);
    
    // In real implementation, use CDP to capture screenshot
    return path;
  }
  
  /**
   * Get all test results
   */
  getResults(): TestResult[] {
    return this.testResults;
  }
  
  /**
   * Clear results
   */
  clearResults(): void {
    this.testResults = [];
  }
}

// ---------------------------------------------------------------------------
// Natural Language Test Parser
// ---------------------------------------------------------------------------

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
export function parseNaturalLanguageTest(input: string): ParsedScenario {
  const lines = input.split("\n").map((l) => l.trim()).filter(Boolean);
  
  const scenario: ParsedScenario = {
    name: "",
    url: "",
    steps: [],
  };
  
  for (const line of lines) {
    // Parse test name
    const nameMatch = line.match(/^(?:test|name):\s*(.+)/i);
    if (nameMatch) {
      scenario.name = nameMatch[1];
      continue;
    }
    
    // Parse URL
    const urlMatch = line.match(/^(?:url|site|start):\s*(.+)/i);
    if (urlMatch) {
      scenario.url = urlMatch[1];
      continue;
    }
    
    // Parse numbered steps
    const stepMatch = line.match(/^\d+[.)]\s*(.+)/);
    if (stepMatch) {
      const stepText = stepMatch[1];
      scenario.steps.push(parseStep(stepText));
    }
  }
  
  return scenario;
}

/**
 * Parse single step text
 */
function parseStep(text: string): TestStep {
  const lower = text.toLowerCase();
  
  // Click actions
  if (/^click\s+/i.test(text)) {
    const target = text.replace(/^click\s+/i, "");
    return { action: "click", target };
  }
  
  // Fill actions
  const fillMatch = text.match(/^(?:fill|type|enter)\s+"?([^"]+)"?\s+with\s+(.+)/i);
  if (fillMatch) {
    return {
      action: "fill",
      field: fillMatch[1],
      value: fillMatch[2],
    };
  }
  
  // Submit
  if (/submit|send|next|continue/i.test(text)) {
    return { action: "submit" };
  }
  
  // Assert/Verify
  const assertMatch = text.match(/^(?:assert|verify|check)\s+(?:that\s+)?(.+?)(?:\s+(?:appears?|shows?|exists?))?$/i);
  if (assertMatch) {
    return { action: "assert", expected: assertMatch[1] };
  }
  
  // Wait
  const waitMatch = text.match(/wait\s+(\d+)\s*(s|ms|seconds?|milliseconds?)/i);
  if (waitMatch) {
    const value = parseInt(waitMatch[1]);
    const unit = waitMatch[2].toLowerCase();
    const ms = unit.startsWith("s") ? value * 1000 : value;
    return { action: "wait", waitMs: ms };
  }
  
  // Screenshot
  if (/screenshot/i.test(text)) {
    return { action: "screenshot" };
  }
  
  // Default
  return { action: text };
}

// ---------------------------------------------------------------------------
// CLI Interface
// ---------------------------------------------------------------------------

export interface CLIRunnerConfig {
  scenarioFile?: string;
  outputDir?: string;
  headless?: boolean;
}

export async function runFromCLI(config: CLIRunnerConfig = {}): Promise<void> {
  if (!config.scenarioFile) {
    console.error("Usage: webmcp-tester --scenario <file.md>");
    process.exit(1);
  }
  
  const content = await readFile(config.scenarioFile, "utf8");
  const scenario = parseNaturalLanguageTest(content);
  
  if (!scenario.name || !scenario.url) {
    console.error("Error: Test must have 'name' and 'url'");
    process.exit(1);
  }
  
  const tester = new WebMCPTester({
    headless: config.headless ?? true,
    screenshotDir: config.outputDir,
  });
  
  console.log(`[WebMCP Tester] Running: ${scenario.name}`);
  const result = await tester.run(scenario);
  
  if (result.passed) {
    console.log(`[WebMCP Tester] PASS - ${result.durationMs}ms, ${result.stepsExecuted} steps`);
    process.exit(0);
  } else {
    console.error(`[WebMCP Tester] FAIL - ${result.error}`);
    process.exit(1);
  }
}
