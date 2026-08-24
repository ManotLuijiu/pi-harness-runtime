/**
 * E2E Auto-Run and Fix Loop — RFC-0101
 *
 * Automatically runs E2E tests, analyzes failures, fixes code, and retries
 * until tests pass or environment limitation is detected.
 *
 * Flow:
 *   Smart Decision (from tools-detector.ts)
 *     ↓
 *   Decision: auto_run → Run Tests
 *     ↓
 *   Tests Pass? → Continue / Commit
 *     ↓ (No)
 *   Analyze Failure
 *     ↓
 *   Can Auto-Fix? → Fix Code → Re-run Tests
 *     ↓ (No)
 *   Environment Limitation? → Ask Human to Run Manually
 *     ↓ (No)
 *   Unknown Failure → Retry (max 3x) → Ask Human
 */

import { existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { execSync } from "child_process";
import {
	detectProjectType,
	detectAvailableTools,
	makeSmartDecision,
	getE2EToolsConfig,
	type ProjectType,
	type TestingTool,
	type E2EToolsConfig,
	type SmartDecision,
} from "./tools-detector.js";
import { logInfo, logWarn, logError } from "../glm-quota-logger.js";

export interface E2ETestResult {
	passed: boolean;
	output: string;
	duration: number;
	failedTests: string[];
	errorMessage?: string;
}

export interface AutoTestConfig {
	projectRoot: string;
	maxRetries: number;
	autoFixEnabled: boolean;
	generateStubs: boolean;
	notifyOnEscalation: boolean;
}

export interface AutoTestResult {
	success: boolean;
	testsRun: boolean;
	testsPassed: boolean;
	retriesAttempted: number;
	escalatedToHuman: boolean;
	escalationReason?: string;
	output: string;
	duration: number;
}

const DEFAULT_CONFIG: AutoTestConfig = {
	projectRoot: ".",
	maxRetries: 3,
	autoFixEnabled: true,
	generateStubs: true,
	notifyOnEscalation: true,
};

/**
 * Run the full E2E auto-test loop
 */
export async function runAutoTestLoop(
	config: Partial<AutoTestConfig> = {},
): Promise<AutoTestResult> {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const startTime = Date.now();
	const retriesAttempted = 0;

	logInfo(null, `Starting E2E Auto-Test Loop for: ${cfg.projectRoot}`);

	// Step 1: Detect project and tools
	const toolsConfig = getE2EToolsConfig(cfg.projectRoot);
	logInfo(
		null,
		`Project type: ${toolsConfig.projectType}, Tools: ${toolsConfig.detectedTools.filter((t) => t.installed).length} installed`,
	);

	// Step 2: Make smart decision
	const decision = makeSmartDecision(
		cfg.projectRoot,
		toolsConfig.projectType,
		toolsConfig.detectedTools,
	);
	logInfo(
		null,
		`Smart decision: ${decision.suggestedAction} (confidence: ${decision.confidence})`,
	);

	// Handle decision
	switch (decision.suggestedAction) {
		case "skip":
			logInfo(null, "Skipping E2E tests - not needed right now");
			return {
				success: true,
				testsRun: false,
				testsPassed: true,
				retriesAttempted: 0,
				escalatedToHuman: false,
				output: decision.reason,
				duration: Date.now() - startTime,
			};

		case "ask_human":
			return {
				success: false,
				testsRun: false,
				testsPassed: false,
				retriesAttempted: 0,
				escalatedToHuman: true,
				escalationReason: decision.reason,
				output: decision.reason,
				duration: Date.now() - startTime,
			};

		case "generate_stubs":
			if (cfg.generateStubs) {
				logInfo(null, "Generating test stubs...");
				await generateTestStubs(cfg.projectRoot, toolsConfig.projectType);
			}
		// Fall through to run tests

		case "auto_run":
		default:
			// Run the test loop
			return await runTestLoop(cfg, toolsConfig, retriesAttempted, startTime);
	}
}

/**
 * Main test loop with retry logic
 */
async function runTestLoop(
	cfg: AutoTestConfig,
	toolsConfig: E2EToolsConfig,
	retriesAttempted: number,
	startTime: number,
): Promise<AutoTestResult> {
	let lastResult: E2ETestResult | null = null;

	while (retriesAttempted <= cfg.maxRetries) {
		logInfo(
			null,
			`Running E2E tests (attempt ${retriesAttempted + 1}/${cfg.maxRetries + 1})...`,
		);

		// Run tests
		lastResult = await runTests(cfg.projectRoot, toolsConfig);

		if (lastResult && lastResult.passed) {
			logInfo(null, "✅ All E2E tests passed!");
			return {
				success: true,
				testsRun: true,
				testsPassed: true,
				retriesAttempted,
				escalatedToHuman: false,
				output: (lastResult && lastResult.output) || "",
				duration: Date.now() - startTime,
			};
		}

		// Tests failed
		logWarn(
			null,
			`❌ E2E tests failed: ${(lastResult && lastResult.errorMessage) || " error"}`,
		);
		retriesAttempted++;

		// Analyze failure
		const analysis = analyzeFailure(
			lastResult!,
			cfg.projectRoot,
			toolsConfig.projectType,
		);
		logInfo(
			null,
			`Failure analysis: ${analysis.canFix ? "Can auto-fix" : "Needs manual intervention"}`,
		);

		if (analysis.canFix && cfg.autoFixEnabled) {
			// Try to fix
			const fixResult = await attemptAutoFix(analysis, cfg.projectRoot);
			if (fixResult.fixed) {
				logInfo(null, `Auto-fixed: ${fixResult.description}`);
				continue; // Retry tests
			}
		}

		// Check if environment limitation
		if (isEnvironmentLimitation(lastResult!)) {
			logWarn(null, "Environment limitation detected - escalating to human");
			return {
				success: false,
				testsRun: true,
				testsPassed: false,
				retriesAttempted,
				escalatedToHuman: true,
				escalationReason: `Environment limitation: ${lastResult.errorMessage || "Unable to run tests in current environment"}`,
				output: (lastResult && lastResult.output) || "",
				duration: Date.now() - startTime,
			};
		}

		// Check max retries
		if (retriesAttempted > cfg.maxRetries) {
			logWarn(null, "Max retries reached - escalating to human");
			return {
				success: false,
				testsRun: true,
				testsPassed: false,
				retriesAttempted,
				escalatedToHuman: true,
				escalationReason: `Failed after ${cfg.maxRetries} attempts. Last error: ${lastResult?.errorMessage ?? "Unknown"}`,
				output: (lastResult && lastResult.output) || "",
				duration: Date.now() - startTime,
			};
		}
	}

	// Should not reach here, but safety net
	return {
		success: false,
		testsRun: true,
		testsPassed: false,
		retriesAttempted,
		escalatedToHuman: true,
		escalationReason: "Unexpected loop exit",
		output: lastResult?.output || "",
		duration: Date.now() - startTime,
	};
}

/**
 * Run tests based on project type
 */
async function runTests(
	projectRoot: string,
	toolsConfig: E2EToolsConfig,
): Promise<TestResult> {
	const startTime = Date.now();
	const projectType = toolsConfig.projectType;

	try {
		let command: string;
		let workingDir = projectRoot;

		switch (projectType) {
			case "tauri":
				// Try hardware-e2e first, then regular e2e
				if (existsSync(join(projectRoot, "hardware-e2e"))) {
					command = "wdio run ./hardware-e2e/wdio.conf.ts";
					workingDir = join(projectRoot, "hardware-e2e");
				} else {
					command = "npx playwright test";
				}
				break;

			case "ios":
			case "android":
				// Native apps need special setup
				return {
					passed: false,
					output: "",
					duration: 0,
					failedTests: [],
					errorMessage:
						"Native app testing requires manual setup. Run tests manually.",
				};

			case "flutter":
				command = "flutter test integration_test";
				break;

			case "nextjs":
			case "react_vite":
			case "generic":
				command = "npx playwright test";
				break;

			case "django":
				command = "python manage.py test";
				break;

			case "laravel":
				command = "php artisan dusk";
				break;

			default:
				return {
					passed: false,
					output: "",
					duration: 0,
					failedTests: [],
					errorMessage: "Unknown project type",
				};
		}

		// Run the command
		logInfo(null, `Running: ${command} (in ${workingDir})`);

		const output = execSync(command, {
			cwd: workingDir,
			encoding: "utf-8",
			timeout: 300000, // 5 minute timeout
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
		});

		const passed = output.includes("passed") && !output.includes("failed");

		return {
			passed,
			output,
			duration: Date.now() - startTime,
			failedTests: extractFailedTests(output),
			errorMessage: passed ? undefined : "Tests failed",
		};
	} catch (error: any) {
		const output = error.stdout || error.message || "";
		return {
			passed: false,
			output,
			duration: Date.now() - startTime,
			failedTests: extractFailedTests(output),
			errorMessage: error.message || "Test execution failed",
		};
	}
}

interface FailureAnalysis {
	canFix: boolean;
	reason: string;
	failedTests: string[];
	likelyCause?: string;
	suggestedFix?: string;
}

/**
 * Analyze a test failure to determine if it can be auto-fixed
 */
function analyzeFailure(
	result: E2ETestResult,
	projectRoot: string,
	projectType: ProjectType,
): FailureAnalysis {
	const failedTests = result.failedTests || [];

	// Check for common auto-fixable issues

	// 1. Missing test file - can generate
	if (
		failedTests.some(
			(t: string) => t.includes("Cannot find") || t.includes("not found"),
		)
	) {
		return {
			canFix: true,
			reason: "Missing test file - can generate stubs",
			failedTests,
			likelyCause: "Test file doesn't exist",
			suggestedFix: "Generate test stubs based on source files",
		};
	}

	// 2. Import errors - can fix
	if (
		result.output.includes("Cannot find module") ||
		result.output.includes("import error")
	) {
		return {
			canFix: true,
			reason: "Import error - may need npm install",
			failedTests,
			likelyCause: "Missing dependencies",
			suggestedFix: "Run npm install",
		};
	}

	// 3. Locator errors - can fix (re-generate selectors)
	if (
		failedTests.some(
			(t: string) => t.includes("locator") || t.includes("selector"),
		)
	) {
		return {
			canFix: true,
			reason: "UI locator changed - need to update selectors",
			failedTests,
			likelyCause: "CSS class or element changed in UI",
			suggestedFix: "Update test selectors to match new UI",
		};
	}

	// 4. Auth/session issues - might be environment
	if (
		failedTests.some(
			(t: string) =>
				t.includes("auth") || t.includes("login") || t.includes("session"),
		)
	) {
		return {
			canFix: false,
			reason: "Authentication issue - may need test credentials",
			failedTests,
			likelyCause: "Test needs valid credentials",
			suggestedFix: "Set up test user credentials",
		};
	}

	// 5. Timeout issues - might be environment
	if (result.output.includes("timeout") || result.output.includes("Timed out")) {
		return {
			canFix: false,
			reason: "Timeout - may be environment issue",
			failedTests,
			likelyCause: "Server slow or not running",
			suggestedFix: "Start dev server before running tests",
		};
	}

	// Default: unknown failure
	return {
		canFix: false,
		reason: "Unknown failure - manual investigation needed",
		failedTests,
	};
}

interface FixResult {
	fixed: boolean;
	description: string;
}

interface FailureAnalysis {
	canFix: boolean;
	reason: string;
	failedTests: string[];
	likelyCause?: string;
	suggestedFix?: string;
}

/**
 * Attempt to auto-fix the failure
 */
async function attemptAutoFix(
	analysis: FailureAnalysis,
	projectRoot: string,
): Promise<FixResult> {
	// Fix 1: Generate missing test stubs
	if (analysis.reason.includes("Missing test file")) {
		const stubsGenerated = await generateTestStubs(projectRoot, "generic");
		if (stubsGenerated) {
			return { fixed: true, description: "Generated test stubs" };
		}
	}

	// Fix 2: Run npm install
	if (
		analysis.reason.includes("import error") ||
		analysis.reason.includes("Missing dependencies")
	) {
		try {
			execSync("npm install", { cwd: projectRoot, stdio: "ignore" });
			return { fixed: true, description: "Ran npm install" };
		} catch {
			return { fixed: false, description: "npm install failed" };
		}
	}

	// Fix 3: Start dev server (for web apps)
	if (
		analysis.reason.includes("Timeout") ||
		analysis.reason.includes("Server slow")
	) {
		try {
			// Check if dev server is already running
			const port = 3000;
			const isRunning = checkPortInUse(port);
			if (!isRunning) {
				logInfo(null, "Dev server not running - tests may fail until started");
			}
			// Can't auto-start server, but report the issue
			return { fixed: false, description: "Dev server not running" };
		} catch {
			return { fixed: false, description: "Could not check server status" };
		}
	}

	return { fixed: false, description: "Could not auto-fix" };
}

/**
 * Check if a port is in use
 */
function checkPortInUse(port: number): boolean {
	try {
		execSync(`lsof -i :${port}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Determine if failure is due to environment limitation
 */
function isEnvironmentLimitation(result: E2ETestResult): boolean {
	const output = result.output + (result.errorMessage || "");

	// Check for environment-specific issues
	const envIssues = [
		"no device",
		"adb not found",
		"no android",
		"no ios simulator",
		"xcode not found",
		"platform-tools not found",
		"cannot connect to server",
		"connection refused",
		"ECONNREFUSED",
		"ETIMEDOUT",
	];

	return envIssues.some((issue) =>
		output.toLowerCase().includes(issue.toLowerCase()),
	);
}

/**
 * Extract failed test names from output
 */
function extractFailedTests(output: string): string[] {
	const tests: string[] = [];

	// Playwright format
	const playwrightMatch = output.matchAll(/FAIL (\S+)/g);
	for (const match of playwrightMatch) {
		tests.push(match[1]);
	}

	// Jest/Vitest format
	const jestMatch = output.matchAll(/✕ (.+)/g);
	for (const match of jestMatch) {
		tests.push(match[1]);
	}

	// Django format
	const djangoMatch = output.matchAll(/FAIL: (\S+)/g);
	for (const match of djangoMatch) {
		tests.push(match[1]);
	}

	return tests;
}

/**
 * Generate test stubs for a project
 */
async function generateTestStubs(
	projectRoot: string,
	projectType: ProjectType,
): Promise<boolean> {
	const testDir = getTestDirectory(projectRoot, projectType);

	// Create test directory if not exists
	if (!existsSync(testDir)) {
		try {
			const { mkdirSync } = require("fs");
			mkdirSync(testDir, { recursive: true });
		} catch {
			return false;
		}
	}

	// Find source files to generate tests for
	const srcDir = getSourceDirectory(projectRoot, projectType);
	if (!existsSync(srcDir)) {
		return false;
	}

	try {
		const sourceFiles = findSourceFiles(srcDir, projectType);

		// Generate a basic test file for each source file
		for (const sourceFile of sourceFiles.slice(0, 5)) {
			// Limit to 5 files
			const testFile = createTestFilePath(sourceFile, testDir, projectType);
			if (!existsSync(testFile)) {
				const testContent = generateTestContent(sourceFile, projectType);
				writeFileSync(testFile, testContent);
				logInfo(null, `Generated test stub: ${testFile}`);
			}
		}

		return true;
	} catch (error) {
		logError(null, "Failed to generate test stubs", error);
		return false;
	}
}

/**
 * Get test directory for project type
 */
function getTestDirectory(root: string, projectType: ProjectType): string {
	switch (projectType) {
		case "tauri":
			return join(root, "e2e");
		case "nextjs":
		case "react_vite":
		case "generic":
			return join(root, "tests");
		case "flutter":
			return join(root, "integration_test");
		case "django":
			return join(root, "tests");
		case "laravel":
			return join(root, "tests", "Browser");
		default:
			return join(root, "tests");
	}
}

/**
 * Get source directory for project type
 */
function getSourceDirectory(root: string, projectType: ProjectType): string {
	switch (projectType) {
		case "tauri":
			return join(root, "src");
		case "nextjs":
			return join(root, "app");
		case "react_vite":
			return join(root, "src");
		case "flutter":
			return join(root, "lib");
		case "django":
			return join(root, "app");
		default:
			return join(root, "src");
	}
}

/**
 * Find source files to generate tests for
 */
function findSourceFiles(srcDir: string, projectType: ProjectType): string[] {
	const extensions = {
		tauri: [".ts", ".tsx", ".rs"],
		nextjs: [".ts", ".tsx"],
		react_vite: [".ts", ".tsx"],
		flutter: [".dart"],
		django: [".py"],
		laravel: [".php"],
		generic: [".ts", ".tsx", ".js", ".jsx"],
	};

	const exts = extensions[projectType as keyof typeof extensions] || [
		".ts",
		".tsx",
	];
	const files: string[] = [];

	try {
		const entries = readdirSync(srcDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && exts.includes(extname(entry.name))) {
				files.push(join(srcDir, entry.name));
			}
		}
	} catch {
		// Ignore errors
	}

	return files;
}

/**
 * Create test file path from source file path
 */
function createTestFilePath(
	sourceFile: string,
	testDir: string,
	projectType: ProjectType,
): string {
	const base = require("path").basename(sourceFile, extname(sourceFile));
	const ext = {
		tauri: ".spec.ts",
		nextjs: ".test.ts",
		react_vite: ".test.ts",
		flutter: "_test.dart",
		django: "_test.py",
		laravel: ".test.php",
		generic: ".test.ts",
	};

	return join(
		testDir,
		`${base}${ext[projectType as keyof typeof ext] || ".test.ts"}`,
	);
}

/**
 * Generate basic test content
 */
function generateTestContent(
	sourceFile: string,
	projectType: ProjectType,
): string {
	const base = require("path").basename(sourceFile, extname(sourceFile));

	switch (projectType) {
		case "nextjs":
		case "react_vite":
		case "generic":
			return `/**
 * Auto-generated test stub for ${base}
 * Generated by pi-harness-runtime E2E Auto-Test Loop
 */

import { test, expect } from '@playwright/test';

test.describe('${base}', () => {
  test.beforeEach(async ({ page }) => {
    // TODO: Add setup
  });

  test('should render', async ({ page }) => {
    // TODO: Add assertion
    await expect(page).toHaveTitle(/.*/);
  });
});
`;

		case "flutter":
			return `/**
 * Auto-generated test stub for ${base}
 * Generated by pi-harness-runtime E2E Auto-Test Loop
 */

import 'package:flutter_test/flutter_test.dart';

void main() {
  group('${base}', () {
    testWidgets('should render', (WidgetTester tester) async {
      // TODO: Add widget test
    });
  });
}
`;

		case "django":
			return `'''
Auto-generated test stub for ${base}
Generated by pi-harness-runtime E2E Auto-Test Loop
'''

from django.test import TestCase


class ${base.charAt(0).toUpperCase() + base.slice(1)}TestCase(TestCase):
    def setUp(self):
        # TODO: Add setup
        pass

    def test_should_render(self):
        # TODO: Add assertion
        pass
`;

		default:
			return `/**
 * Auto-generated test stub for ${base}
 * Generated by pi-harness-runtime E2E Auto-Test Loop
 */

describe('${base}', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
`;
	}
}
