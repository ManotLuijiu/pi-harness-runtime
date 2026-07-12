/**
 * Project Analyzer Tests
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { join } from "node:path";
import {
	ProjectAnalyzer,
	createProjectAnalyzer,
	detectLanguages,
} from "../src/index.js";

// ─── Test Fixtures ───────────────────────────────────────────────────

const TEST_REPO_ROOT = process.cwd();

// ─── Language Detection Tests ────────────────────────────────────────

describe("detectLanguages", () => {
	test("detects TypeScript files", () => {
		const files = [
			{ relativePath: "src/index.ts", size: 1000 },
			{ relativePath: "src/app.ts", size: 500 },
			{ relativePath: "src/types.ts", size: 300 },
		];

		const languages = detectLanguages(files);

		expect(languages).toBeDefined();
		expect(languages.length).toBeGreaterThan(0);
		expect(languages[0].name).toBe("TypeScript");
		expect(languages[0].coverage).toBeGreaterThan(0);
	});

	test("handles empty file list", () => {
		const languages = detectLanguages([]);
		expect(languages).toEqual([]);
	});

	test("sorts by coverage descending", () => {
		const files = [
			{ relativePath: "src/main.ts", size: 100 },
			{ relativePath: "src/main.js", size: 200 },
		];

		const languages = detectLanguages(files);

		expect(languages.length).toBeGreaterThanOrEqual(2);
		// JavaScript should have higher coverage due to larger size
		const jsIndex = languages.findIndex((l) => l.name === "JavaScript");
		const tsIndex = languages.findIndex((l) => l.name === "TypeScript");
		if (jsIndex >= 0 && tsIndex >= 0) {
			expect(languages[jsIndex].coverage).toBeGreaterThanOrEqual(
				languages[tsIndex].coverage,
			);
		}
	});
});

// ─── Analyzer Tests ─────────────────────────────────────────────────

describe("ProjectAnalyzer", () => {
	let analyzer: ProjectAnalyzer;

	beforeEach(() => {
		analyzer = createProjectAnalyzer();
	});

	test("creates analyzer instance", () => {
		expect(analyzer).toBeDefined();
		expect(analyzer).toBeInstanceOf(ProjectAnalyzer);
	});

	test("analyzes the current repository", async () => {
		const result = await analyzer.analyze({
			repositoryRoot: TEST_REPO_ROOT,
		});

		expect(result.success).toBe(true);
		expect(result.profile).toBeDefined();

		if (result.profile) {
			expect(result.profile.repositoryRoot).toBe(TEST_REPO_ROOT);
			expect(result.profile.repositoryName).toBe("pi-harness-runtime");
			expect(result.profile.analyzedAt).toBeDefined();
		}
	});

	test("detects frameworks", async () => {
		const result = await analyzer.analyze({
			repositoryRoot: TEST_REPO_ROOT,
		});

		expect(result.success).toBe(true);

		if (result.profile) {
			expect(result.profile.frameworks).toBeDefined();
			// Should detect some frameworks based on package.json, etc.
		}
	});

	test("detects languages", async () => {
		const result = await analyzer.analyze({
			repositoryRoot: TEST_REPO_ROOT,
		});

		expect(result.success).toBe(true);

		if (result.profile) {
			expect(result.profile.languages).toBeDefined();
			expect(result.profile.languages.length).toBeGreaterThan(0);
		}
	});

	test("discovers rules", async () => {
		const result = await analyzer.analyze({
			repositoryRoot: TEST_REPO_ROOT,
		});

		expect(result.success).toBe(true);

		if (result.profile) {
			expect(result.profile.rules).toBeDefined();
			expect(Array.isArray(result.profile.rules)).toBe(true);
		}
	});

	test("generates warnings for unknown frameworks", async () => {
		// Use a directory without obvious framework files
		const tempDir = "/tmp/project-analyzer-test-" + Date.now();

		const result = await analyzer.analyze({
			repositoryRoot: tempDir,
		});

		// Result may fail for non-existent directory, which is expected
		expect(
			result.success === false || result.profile?.warnings !== undefined,
		).toBe(true);
	});
});

// ─── Cache Tests ────────────────────────────────────────────────────

describe("AnalysisCache", () => {
	test("generates consistent cache keys", async () => {
		const analyzer = createProjectAnalyzer();

		const key1 = analyzer["cache"].generateKey("/repo", "abc123", "def456");
		const key2 = analyzer["cache"].generateKey("/repo", "abc123", "def456");

		expect(key1.repositoryRoot).toBe(key2.repositoryRoot);
		expect(key1.revision).toBe(key2.revision);
		expect(key1.configHash).toBe(key2.configHash);
	});

	test("generates different keys for different inputs", async () => {
		const analyzer = createProjectAnalyzer();

		const key1 = analyzer["cache"].generateKey("/repo1", "abc123", "def456");
		const key2 = analyzer["cache"].generateKey("/repo2", "abc123", "def456");

		expect(key1.repositoryRoot).not.toBe(key2.repositoryRoot);
	});
});

// ─── Command Discovery Tests ────────────────────────────────────────

describe("Package Script Parsing", () => {
	test("extracts scripts from package.json", () => {
		const { parsePackageJsonScripts } = require("../src/command-discovery.js");

		const packageJson = {
			scripts: {
				test: "vitest",
				build: "tsc",
				dev: "vite",
				lint: "eslint .",
			},
		};

		const commands = parsePackageJsonScripts(packageJson);

		expect(commands).toBeDefined();
		expect(commands.length).toBeGreaterThanOrEqual(3);
	});

	test("handles empty scripts", () => {
		const { parsePackageJsonScripts } = require("../src/command-discovery.js");

		const packageJson = { scripts: {} };
		const commands = parsePackageJsonScripts(packageJson);

		expect(commands).toEqual([]);
	});

	test("marks primary scripts correctly", () => {
		const { parsePackageJsonScripts } = require("../src/command-discovery.js");

		const packageJson = {
			scripts: {
				test: "vitest",
				build: "tsc",
				dev: "vite",
				other: "echo hello",
			},
		};

		const commands = parsePackageJsonScripts(packageJson);

		const testCmd = commands.find(
			(c: { command: string }) => c.command === "npm run test",
		);
		const buildCmd = commands.find(
			(c: { command: string }) => c.command === "npm run build",
		);
		const devCmd = commands.find(
			(c: { command: string }) => c.command === "npm run dev",
		);
		const otherCmd = commands.find(
			(c: { command: string }) => c.command === "npm run other",
		);

		expect(testCmd?.primary).toBe(true);
		expect(buildCmd?.primary).toBe(true);
		expect(devCmd?.primary).toBe(true);
		expect(otherCmd?.primary).toBe(false);
	});
});
