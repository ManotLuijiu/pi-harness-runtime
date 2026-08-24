/**
 * E2E Testing Tools Detector & Advisor — RFC-0101
 *
 * Detects project type and available testing tools, then presents
 * relevant options to human or auto-decides based on code changes.
 *
 * Case-based mapping:
 * - Tauri/Rust → WebdriverIO + @wdio/tauri-service, ADB, scrcpy
 * - iOS/Swift → XCUITest, fastlane, simctl
 * - Android/Kotlin → Espresso, ADB, Gradle
 * - Web (Next.js/React) → Playwright, Playwright CLI
 * - Django → Django test client, Playwright
 * - Laravel → Laravel Dusk, Playwright
 *
 * Flow:
 *   Code Changed
 *     → Detect Project Type
 *     → Scan Available Tools
 *     → Smart Decision (auto vs ask human)
 *     → Generate Test Stubs (if needed)
 *     → Run Tests
 *     → Auto-fix if failed
 *     → Escalate if stuck
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { homedir } from "node:os";

export type NativeAppType =
	| "tauri"
	| "ios"
	| "android"
	| "electron"
	| "flutter";
export type WebFramework =
	| "nextjs"
	| "react_vite"
	| "django"
	| "laravel"
	| "generic";
export type ProjectType = NativeAppType | WebFramework | "unknown";

export interface TestingTool {
	name: string;
	description: string;
	command?: string;
	installed: boolean;
	installHint?: string;
}

export interface E2EToolsConfig {
	projectRoot: string;
	projectType: ProjectType;
	detectedTools: TestingTool[];
	recommendedTools: TestingTool[];
	needsManualSetup: boolean;
	setupInstructions?: string;
}

export interface SmartDecision {
	shouldAutoTest: boolean;
	confidence: number; // 0-1
	reason: string;
	suggestedAction: "auto_run" | "ask_human" | "skip" | "generate_stubs";
}

/** Case-based testing tools mapping */
const TESTING_TOOLS_MAP: Record<
	ProjectType,
	{
		autoTools: TestingTool[];
		manualTools: TestingTool[];
		detectionSignals: string[];
	}
> = {
	tauri: {
		detectionSignals: [
			"src-tauri/Cargo.toml",
			"tauri.conf.json",
			"src-tauri/src/lib.rs",
		],
		autoTools: [
			{
				name: "WebdriverIO + @wdio/tauri-service",
				description: "E2E tests via embedded WebDriver in Tauri app",
				command: "wdio run ./hardware-e2e/wdio.conf.ts",
				installed: false,
				installHint: "npm install @wdio/cli @wdio/tauri-service",
			},
			{
				name: "Playwright (for web components)",
				description: "Test web views rendered in WebView",
				command: "npx playwright test",
				installed: false,
				installHint: "npm install @playwright/test",
			},
		],
		manualTools: [
			{
				name: "ADB (Android Debug Bridge)",
				description: "Device control: screenshot, tap, swipe, shell",
				installed: false,
				installHint: "Install Android SDK platform tools",
			},
			{
				name: "scrcpy",
				description: "Mirror Android screen to desktop",
				installed: false,
				installHint: "brew install scrcpy (macOS) or apt install scrcpy (Linux)",
			},
		],
	},
	ios: {
		detectionSignals: [
			"*.xcodeproj",
			"*.xcworkspace",
			"Package.swift",
			"ios/*.swift",
			"App/*.swift",
		],
		autoTools: [
			{
				name: "XCUITest",
				description: "Native iOS UI testing",
				installed: false,
				installHint: "Built into Xcode",
			},
			{
				name: "fastlane",
				description: "Automate iOS testing and deployment",
				command: "fastlane scan",
				installed: false,
				installHint: "gem install fastlane",
			},
		],
		manualTools: [
			{
				name: "simctl",
				description: "Control iOS Simulator from command line",
				installed: false,
				installHint: "xcrun simctl list",
			},
		],
	},
	android: {
		detectionSignals: [
			"android/app/build.gradle",
			"app/build.gradle.kts",
			"settings.gradle",
			"settings.gradle.kts",
		],
		autoTools: [
			{
				name: "Espresso",
				description: "Android UI testing framework",
				command: "./gradlew connectedAndroidTest",
				installed: false,
				installHint: "Included in Android SDK",
			},
			{
				name: "ADB (Android Debug Bridge)",
				description: "Device control: screenshot, tap, swipe, shell",
				installed: false,
				installHint: "Install Android SDK platform tools",
			},
		],
		manualTools: [
			{
				name: "Appium",
				description: "Cross-platform mobile automation",
				installed: false,
				installHint: "npm install -g appium",
			},
			{
				name: "scrcpy",
				description: "Mirror Android screen to desktop",
				installed: false,
				installHint: "brew install scrcpy (macOS) or apt install scrcpy (Linux)",
			},
		],
	},
	electron: {
		detectionSignals: [
			"electron-builder",
			"electron/main.ts",
			"electron/main.js",
			"package.json", // with electron dependency
		],
		autoTools: [
			{
				name: "Playwright",
				description: "E2E testing for Electron apps",
				command: "npx playwright test",
				installed: false,
				installHint: "npm install @playwright/test",
			},
			{
				name: "Spectron (legacy)",
				description: "Electron-specific testing (deprecated)",
				installed: false,
				installHint: "npm install @electron/spectron",
			},
		],
		manualTools: [],
	},
	flutter: {
		detectionSignals: ["pubspec.yaml", "lib/main.dart", "test/*.dart"],
		autoTools: [
			{
				name: "Flutter Test",
				description: "Unit and widget testing",
				command: "flutter test",
				installed: false,
				installHint: "flutter pub run test",
			},
			{
				name: "Integration Test",
				description: "Full app E2E testing",
				command: "flutter test integration_test",
				installed: false,
				installHint: "flutter pub run integration_test",
			},
		],
		manualTools: [
			{
				name: " Patrol",
				description: "Native E2E testing for Flutter",
				installed: false,
				installHint: "flutter pub add patrol",
			},
		],
	},
	nextjs: {
		detectionSignals: [
			"next.config.ts",
			"next.config.js",
			"package.json", // with next dependency
			"app/",
			"pages/",
		],
		autoTools: [
			{
				name: "Playwright",
				description: "E2E testing for Next.js apps",
				command: "npx playwright test",
				installed: false,
				installHint: "npm install @playwright/test && npx playwright install",
			},
		],
		manualTools: [],
	},
	react_vite: {
		detectionSignals: [
			"vite.config.ts",
			"vite.config.js",
			"package.json", // with vite dependency
			"src/main.tsx",
			"src/main.jsx",
		],
		autoTools: [
			{
				name: "Playwright",
				description: "E2E testing for Vite apps",
				command: "npx playwright test",
				installed: false,
				installHint: "npm install @playwright/test && npx playwright install",
			},
			{
				name: "Vitest",
				description: "Unit testing (complements Playwright)",
				command: "npx vitest",
				installed: false,
				installHint: "npm install vitest",
			},
		],
		manualTools: [],
	},
	django: {
		detectionSignals: [
			"manage.py",
			"settings.py",
			"requirements.txt", // with django
		],
		autoTools: [
			{
				name: "Django Test Client",
				description: "Built-in Django testing",
				command: "python manage.py test",
				installed: false,
			},
			{
				name: "Playwright",
				description: "Browser-based E2E testing",
				command: "npx playwright test",
				installed: false,
				installHint: "npm install @playwright/test",
			},
		],
		manualTools: [],
	},
	laravel: {
		detectionSignals: [
			"artisan",
			"database/seeders",
			"composer.json", // with laravel
		],
		autoTools: [
			{
				name: "Laravel Dusk",
				description: "Browser testing for Laravel",
				command: "php artisan dusk",
				installed: false,
				installHint: "composer require --dev laravel/dusk",
			},
			{
				name: "Playwright",
				description: "Browser-based E2E testing",
				command: "npx playwright test",
				installed: false,
				installHint: "npm install @playwright/test",
			},
		],
		manualTools: [],
	},
	generic: {
		detectionSignals: ["package.json"],
		autoTools: [
			{
				name: "Playwright",
				description: "Generic E2E testing",
				command: "npx playwright test",
				installed: false,
				installHint: "npm install @playwright/test && npx playwright install",
			},
		],
		manualTools: [],
	},
	unknown: {
		detectionSignals: [],
		autoTools: [],
		manualTools: [],
	},
};

/**
 * Detect project type from project root directory
 */
export function detectProjectType(projectRoot: string): ProjectType {
	// Check for Tauri/Rust
	if (
		hasFile(projectRoot, "src-tauri/Cargo.toml") ||
		hasFile(projectRoot, "tauri.conf.json")
	) {
		return "tauri";
	}

	// Check for iOS/Swift
	if (
		hasFileWithExt(projectRoot, ".xcodeproj") ||
		hasFileWithExt(projectRoot, ".xcworkspace") ||
		hasFile(projectRoot, "Package.swift") ||
		hasFile(projectRoot, "ios/AppDelegate.swift")
	) {
		return "ios";
	}

	// Check for Android/Kotlin
	if (
		hasFile(projectRoot, "android/app/build.gradle") ||
		hasFile(projectRoot, "app/build.gradle.kts") ||
		hasFile(projectRoot, "settings.gradle") ||
		hasFile(projectRoot, "settings.gradle.kts")
	) {
		return "android";
	}

	// Check for Flutter
	if (
		hasFile(projectRoot, "pubspec.yaml") &&
		(hasFile(projectRoot, "lib/main.dart") || hasFile(projectRoot, "test/"))
	) {
		return "flutter";
	}

	// Check for Electron
	if (hasFile(projectRoot, "package.json")) {
		const pkg = readPackageJson(projectRoot);
		if (
			pkg.dependencies?.["electron"] ||
			pkg.devDependencies?.["electron"] ||
			pkg.dependencies?.["electron-builder"]
		) {
			return "electron";
		}
	}

	// Check for Next.js
	if (
		hasFile(projectRoot, "next.config.ts") ||
		hasFile(projectRoot, "next.config.js") ||
		(hasFile(projectRoot, "package.json") &&
			(hasFile(projectRoot, "app/") || hasFile(projectRoot, "pages/")))
	) {
		const pkg = readPackageJson(projectRoot);
		if (pkg.dependencies?.["next"] || pkg.devDependencies?.["next"]) {
			return "nextjs";
		}
	}

	// Check for React/Vite
	if (
		hasFile(projectRoot, "vite.config.ts") ||
		hasFile(projectRoot, "vite.config.js")
	) {
		return "react_vite";
	}

	// Check for Django
	if (hasFile(projectRoot, "manage.py") || hasFile(projectRoot, "settings.py")) {
		return "django";
	}

	// Check for Laravel
	if (
		hasFile(projectRoot, "artisan") ||
		hasFile(projectRoot, "database/seeders")
	) {
		return "laravel";
	}

	// Check for generic web project
	if (hasFile(projectRoot, "package.json")) {
		return "generic";
	}

	return "unknown";
}

/**
 * Detect available testing tools in the project
 */
export function detectAvailableTools(
	projectRoot: string,
	projectType: ProjectType,
): TestingTool[] {
	const tools: TestingTool[] = [];
	const config = TESTING_TOOLS_MAP[projectType];

	if (!config) return tools;

	// Check for each tool
	for (const tool of [...config.autoTools, ...config.manualTools]) {
		const toolCopy = { ...tool };

		// Check if installed via package.json
		if (tool.installHint?.startsWith("npm")) {
			const pkg = readPackageJson(projectRoot);
			const pkgName = tool.installHint.match(/@[\w-]+/)?.[0];
			if (pkgName) {
				toolCopy.installed =
					!!pkg.dependencies?.[pkgName] || !!pkg.devDependencies?.[pkgName];
			}
		}

		// Check for CLI tools in PATH
		if (tool.command) {
			const cmd = tool.command.split(" ")[0];
			toolCopy.installed = isCommandAvailable(cmd);
		}

		tools.push(toolCopy);
	}

	return tools;
}

/**
 * Get recommended tools (auto-tools that are installed)
 */
export function getRecommendedTools(tools: TestingTool[]): TestingTool[] {
	return tools.filter((t) => t.installed);
}

/**
 * Smart decision algorithm to determine if testing is needed
 *
 * Factors:
 * - Project type (native apps need more manual setup)
 * - Available tools
 * - Recent code changes (heuristic)
 * - Test coverage (if tests exist)
 */
export function makeSmartDecision(
	projectRoot: string,
	projectType: ProjectType,
	availableTools: TestingTool[],
): SmartDecision {
	const installedAutoTools = availableTools.filter((t) => t.installed);

	// No tools available = ask human
	if (installedAutoTools.length === 0) {
		return {
			shouldAutoTest: false,
			confidence: 0.1,
			reason: "No testing tools installed. Ask human for setup.",
			suggestedAction: "ask_human",
		};
	}

	// Check if test files exist
	const testFilesExist = hasTestFiles(projectRoot, projectType);
	const testDir = getTestDir(projectRoot, projectType);
	const testFileCount = countTestFiles(projectRoot, testDir);

	// Check for recent UI changes (heuristic)
	const hasRecentUIChanges = checkRecentUIChanges(projectRoot);

	// Native apps (Tauri, iOS, Android) need more careful consideration
	if (["tauri", "ios", "android"].includes(projectType)) {
		if (!installedAutoTools.some((t) => t.name.includes("WebdriverIO"))) {
			return {
				shouldAutoTest: false,
				confidence: 0.4,
				reason:
					"Native app detected. Setup requires additional tools (WebdriverIO for Tauri). Ask human.",
				suggestedAction: "ask_human",
			};
		}

		// Has hardware testing setup
		return {
			shouldAutoTest: true,
			confidence: 0.7,
			reason:
				"Native app with WebdriverIO available. Will auto-run if tests exist.",
			suggestedAction: testFilesExist ? "auto_run" : "generate_stubs",
		};
	}

	// Web apps are easier to test automatically
	if (["nextjs", "react_vite", "generic"].includes(projectType)) {
		const hasPlaywright = installedAutoTools.some((t) =>
			t.name.includes("Playwright"),
		);

		if (!hasPlaywright) {
			return {
				shouldAutoTest: false,
				confidence: 0.3,
				reason:
					"Web app detected but Playwright not installed. Ask human to install.",
				suggestedAction: "ask_human",
			};
		}

		// Good setup for auto-testing
		if (testFilesExist) {
			return {
				shouldAutoTest: true,
				confidence: 0.9,
				reason: `Found ${testFileCount} test file(s). Auto-running tests.`,
				suggestedAction: "auto_run",
			};
		}

		// No tests but has UI code = generate stubs
		if (hasRecentUIChanges) {
			return {
				shouldAutoTest: false,
				confidence: 0.6,
				reason: "UI changes detected but no tests found. Generate stubs?",
				suggestedAction: "generate_stubs",
			};
		}

		return {
			shouldAutoTest: false,
			confidence: 0.5,
			reason: "No test files found. Consider generating some?",
			suggestedAction: "skip",
		};
	}

	// Backend frameworks
	if (["django", "laravel"].includes(projectType)) {
		const hasFrameworkTest =
			installedAutoTools.some(
				(t) => t.name.includes("Django") || t.name.includes("Laravel Dusk"),
			) || installedAutoTools.some((t) => t.name.includes("Playwright"));

		if (!hasFrameworkTest) {
			return {
				shouldAutoTest: false,
				confidence: 0.3,
				reason:
					"Backend framework detected. Install framework-specific test tools.",
				suggestedAction: "ask_human",
			};
		}

		if (testFilesExist) {
			return {
				shouldAutoTest: true,
				confidence: 0.8,
				reason: `Found ${testFileCount} test file(s). Auto-running tests.`,
				suggestedAction: "auto_run",
			};
		}

		return {
			shouldAutoTest: false,
			confidence: 0.5,
			reason:
				"Backend project detected. Auto-tests skipped (manual review needed).",
			suggestedAction: "skip",
		};
	}

	// Default fallback
	return {
		shouldAutoTest: false,
		confidence: 0.2,
		reason: "Unknown project type. Manual review recommended.",
		suggestedAction: "ask_human",
	};
}

/**
 * Generate tools presentation for human
 */
export function generateToolsPresentation(
	projectType: ProjectType,
	tools: TestingTool[],
): string {
	const config = TESTING_TOOLS_MAP[projectType];
	if (!config) return "";

	const lines: string[] = [];
	lines.push("");
	lines.push("## 🔧 Available E2E Testing Tools");
	lines.push("");

	const autoTools = tools.filter((t) => t.installed);
	const notInstalledTools = tools.filter((t) => !t.installed);

	if (autoTools.length > 0) {
		lines.push("### ✅ Ready to Use");
		lines.push("");
		for (const tool of autoTools) {
			lines.push(`- **${tool.name}**: ${tool.description}`);
			if (tool.command) {
				lines.push(`  Run: \`${tool.command}\``);
			}
		}
		lines.push("");
	}

	if (notInstalledTools.length > 0) {
		lines.push("### 📦 Available (not installed)");
		lines.push("");
		for (const tool of notInstalledTools) {
			lines.push(`- **${tool.name}**: ${tool.description}`);
			if (tool.installHint) {
				lines.push(`  Install: \`${tool.installHint}\``);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

// --- Helper Functions ---

function hasFile(root: string, file: string): boolean {
	return existsSync(join(root, file));
}

function hasFileWithExt(root: string, ext: string): boolean {
	try {
		const entries = readdirSync(root, { withFileTypes: true });
		return entries.some((e) => e.isFile() && e.name.endsWith(ext));
	} catch {
		return false;
	}
}

function readPackageJson(root: string): {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
} {
	try {
		const content = readFileSync(join(root, "package.json"), "utf-8");
		return JSON.parse(content);
	} catch {
		return {};
	}
}

function isCommandAvailable(cmd: string): boolean {
	try {
		const { execSync } = require("child_process");
		execSync(`which ${cmd}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function hasTestFiles(root: string, projectType: ProjectType): boolean {
	const testDir = getTestDir(root, projectType);
	return existsSync(testDir);
}

function getTestDir(root: string, projectType: ProjectType): string {
	switch (projectType) {
		case "tauri":
			return join(root, "hardware-e2e", "specs");
		case "ios":
			return join(root, "ios", "MyAppTests");
		case "android":
			return join(root, "app", "src", "androidTest");
		case "flutter":
			return join(root, "integration_test");
		case "nextjs":
		case "react_vite":
		case "generic":
			return join(root, "tests");
		case "django":
			return join(root, "tests");
		case "laravel":
			return join(root, "tests", "Browser");
		default:
			return join(root, "tests");
	}
}

function countTestFiles(_root: string, testDir: string): number {
	if (!existsSync(testDir)) return 0;

	try {
		const { execSync } = require("child_process");
		const output = execSync(
			`find "${testDir}" -type f \\( -name "*.spec.ts" -o -name "*.test.ts" -o -name "*_test.dart" -o -name "*_test.py" \\) 2>/dev/null | wc -l`,
			{ encoding: "utf-8" },
		);
		return parseInt(output.trim(), 10) || 0;
	} catch {
		return 0;
	}
}

function checkRecentUIChanges(root: string): boolean {
	// Heuristic: check for recent changes in UI-related directories
	const uiDirs = [
		"src/components",
		"app/components",
		"components",
		"pages",
		"app/page",
		"src/views",
	];

	try {
		const { execSync } = require("child_process");
		// Check git for recent UI changes (last 24h)
		for (const dir of uiDirs) {
			if (existsSync(join(root, dir))) {
				const output = execSync(
					`cd "${root}" && git log --oneline --since="24 hours ago" -- "${dir}" 2>/dev/null | head -1`,
					{ encoding: "utf-8" },
				);
				if (output.trim()) return true;
			}
		}
	} catch {
		// Git not available or other error
	}

	return false;
}

/**
 * Get E2E tools config for a project
 */
export function getE2EToolsConfig(projectRoot: string): E2EToolsConfig {
	const projectType = detectProjectType(projectRoot);
	const allTools = detectAvailableTools(projectRoot, projectType);
	const installedTools = allTools.filter((t) => t.installed);
	const needsManualSetup = installedTools.length === 0;

	return {
		projectRoot,
		projectType,
		detectedTools: allTools,
		recommendedTools: installedTools,
		needsManualSetup,
		setupInstructions: generateToolsPresentation(projectType, allTools),
	};
}
