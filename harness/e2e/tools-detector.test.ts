/**
 * E2E Tools Detector Tests
 */

// @ts-expect-error - bun:test types
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
	detectProjectType,
	makeSmartDecision,
	getE2EToolsConfig,
	generateToolsPresentation,
} from "./tools-detector.js";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("E2E Tools Detector", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = tmpdir() + "/e2e-test-" + Date.now();
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("detectProjectType", () => {
		test("detects Next.js project", () => {
			writeFileSync(
				join(tempDir, "package.json"),
				JSON.stringify({ dependencies: { next: "^14.0.0" } }),
			);
			mkdirSync(join(tempDir, "app"));

			const type = detectProjectType(tempDir);
			expect(type).toBe("nextjs");
		});

		test("detects React/Vite project", () => {
			writeFileSync(join(tempDir, "vite.config.ts"), "export default {}");
			writeFileSync(
				join(tempDir, "package.json"),
				JSON.stringify({ dependencies: { react: "^18.0.0" } }),
			);

			const type = detectProjectType(tempDir);
			expect(type).toBe("react_vite");
		});

		test("detects Tauri project", () => {
			mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
			writeFileSync(join(tempDir, "src-tauri/Cargo.toml"), "[package]");

			const type = detectProjectType(tempDir);
			expect(type).toBe("tauri");
		});

		test("detects Django project", () => {
			writeFileSync(join(tempDir, "manage.py"), "#!/usr/bin/env python");
			mkdirSync(join(tempDir, "settings.py").replace("/settings.py", ""), {
				recursive: true,
			});
			writeFileSync(join(tempDir, "settings.py"), "DEBUG=True");

			const type = detectProjectType(tempDir);
			expect(type).toBe("django");
		});

		test("detects unknown project", () => {
			const type = detectProjectType(tempDir);
			expect(type).toBe("unknown");
		});
	});

	describe("makeSmartDecision", () => {
		test("suggests ask_human when no tools installed", () => {
			const decision = makeSmartDecision(tempDir, "nextjs", []);
			expect(decision.suggestedAction).toBe("ask_human");
			expect(decision.confidence).toBeLessThan(0.5);
		});

		test("suggests action for Next.js with Playwright", () => {
			const tools = [
				{
					name: "Playwright",
					installed: true,
					description: "E2E testing",
				},
			];
			const decision = makeSmartDecision(tempDir, "nextjs", tools);
			expect(["auto_run", "generate_stubs", "skip"]).toContain(
				decision.suggestedAction,
			);
		});

		test("suggests ask_human for native apps without WebdriverIO", () => {
			const tools = [
				{
					name: "ADB",
					installed: true,
					description: "Android Debug Bridge",
				},
			];
			const decision = makeSmartDecision(tempDir, "tauri", tools);
			expect(decision.suggestedAction).toBe("ask_human");
		});
	});

	describe("generateToolsPresentation", () => {
		test("generates presentation with installed tools", () => {
			const tools = [
				{
					name: "Playwright",
					installed: true,
					description: "E2E testing for web apps",
					command: "npx playwright test",
				},
				{
					name: "WebdriverIO",
					installed: false,
					description: "Mobile testing",
					installHint: "npm install @wdio/cli",
				},
			];
			const presentation = generateToolsPresentation("nextjs", tools);

			expect(presentation).toContain("Available E2E Testing Tools");
			expect(presentation).toContain("Ready to Use");
			expect(presentation).toContain("Playwright");
			expect(presentation).toContain("not installed");
			expect(presentation).toContain("npm install");
		});

		test("returns header only for unknown project", () => {
			const presentation = generateToolsPresentation("unknown", []);
			expect(presentation).toContain("E2E Testing Tools");
		});
	});

	describe("getE2EToolsConfig", () => {
		test("returns valid config", () => {
			const config = getE2EToolsConfig(tempDir);
			expect(config).toHaveProperty("projectRoot");
			expect(config).toHaveProperty("projectType");
			expect(config).toHaveProperty("detectedTools");
			expect(config).toHaveProperty("recommendedTools");
			expect(config).toHaveProperty("needsManualSetup");
		});
	});
});
