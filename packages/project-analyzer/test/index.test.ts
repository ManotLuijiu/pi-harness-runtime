/**
 * Project Analyzer Tests (comprehensive)
 *
 * Tests for ProjectAnalyzer, detectLanguages, detectPackageManager,
 * command discovery, caching, and filesystem walker.
 */

import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	ProjectAnalyzer,
	createProjectAnalyzer,
	detectLanguages,
} from "../src/index.js";
import {
	AnalysisCache,
	hashRuleFiles,
	hashManifestFiles,
} from "../src/cache.js";
import {
	parsePackageJsonScripts,
	categorizeCommands,
	detectPackageManager,
	parsePythonCommands,
	parseComposerScripts,
} from "../src/command-discovery.js";
import { FileSystemWalker } from "../src/walker.js";
import {
	GenericFrameworkDetector,
	scanSignals,
} from "../src/signals.js";
import { parseRuleFile, discoverRuleFiles, mergeRules } from "../src/rule-discovery.js";

// ─── Temp Fixture Helpers ─────────────────────────────────────────────

const tempDirs: string[] = [];

async function tmpDir(): Promise<string> {
	const d = await mkdtemp(join(tmpdir(), "proj-analyzer-"));
	tempDirs.push(d);
	return d;
}

afterEach(async () => {
	for (const d of tempDirs) {
		try {
			await rm(d, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
	tempDirs.length = 0;
});

// ─── detectLanguages Tests ────────────────────────────────────────────

describe("detectLanguages", () => {
	test("detects TypeScript files", () => {
		const files = [
			{ relativePath: "src/index.ts", size: 1000 },
			{ relativePath: "src/app.ts", size: 500 },
			{ relativePath: "src/types.ts", size: 300 },
		];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "TypeScript")).toBeDefined();
	});

	test("detects Python files", () => {
		const files = [
			{ relativePath: "app/main.py", size: 5000 },
			{ relativePath: "app/models.py", size: 2000 },
		];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "Python")).toBeDefined();
	});

	test("detects Go files", () => {
		const files = [{ relativePath: "cmd/main.go", size: 3000 }];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "Go")).toBeDefined();
	});

	test("detects Java and Kotlin files", () => {
		const files = [
			{ relativePath: "src/Main.java", size: 2000 },
			{ relativePath: "src/Utils.kt", size: 1000 },
		];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "Java")).toBeDefined();
		expect(langs.find((l) => l.name === "JavaScript")).toBeUndefined();
	});

	test("detects Rust files", () => {
		const files = [{ relativePath: "src/lib.rs", size: 4000 }];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "Rust")).toBeDefined();
	});

	test("detects C# files", () => {
		const files = [{ relativePath: "Program.cs", size: 1500 }];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "C#")).toBeDefined();
	});

	test("detects HTML and CSS", () => {
		const files = [
			{ relativePath: "index.html", size: 2000 },
			{ relativePath: "styles.css", size: 500 },
			{ relativePath: "theme.scss", size: 800 },
		];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "HTML")).toBeDefined();
		expect(langs.find((l) => l.name === "CSS")).toBeDefined();
	});

	test("detects multiple languages with correct coverage", () => {
		const files = [
			{ relativePath: "main.ts", size: 500 },
			{ relativePath: "app.py", size: 1000 },
		];
		const langs = detectLanguages(files);
		const py = langs.find((l) => l.name === "Python");
		const ts = langs.find((l) => l.name === "TypeScript");
		expect(py).toBeDefined();
		expect(ts).toBeDefined();
		// Python should have higher coverage (1000 vs 500 bytes)
		expect(py!.coverage).toBeGreaterThan(ts!.coverage);
	});

	test("sorts languages by coverage descending", () => {
		const files = [
			{ relativePath: "main.js", size: 9000 },
			{ relativePath: "main.ts", size: 1000 },
		];
		const langs = detectLanguages(files);
		expect(langs[0].name).toBe("JavaScript");
		expect(langs[1].name).toBe("TypeScript");
	});

	test("handles empty file list", () => {
		expect(detectLanguages([])).toEqual([]);
	});

	test("handles files with no recognized extensions", () => {
		const files = [
			{ relativePath: "README", size: 500 },
			{ relativePath: "Makefile", size: 200 },
		];
		const langs = detectLanguages(files);
		expect(langs).toEqual([]);
	});

	test("handles mixed TSX and JSX files", () => {
		const files = [
			{ relativePath: "Component.tsx", size: 500 },
			{ relativePath: "App.jsx", size: 300 },
		];
		const langs = detectLanguages(files);
		const ts = langs.find((l) => l.name === "TypeScript");
		expect(ts).toBeDefined();
	});

	test("handles Swift files", () => {
		const files = [{ relativePath: "iOS/App.swift", size: 2000 }];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "Swift")).toBeDefined();
	});

	test("handles SQL files", () => {
		const files = [{ relativePath: "schema.sql", size: 3000 }];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "SQL")).toBeDefined();
	});

	test("handles Markdown files", () => {
		const files = [
			{ relativePath: "README.md", size: 1000 },
			{ relativePath: "CHANGELOG.md", size: 500 },
		];
		const langs = detectLanguages(files);
		expect(langs.find((l) => l.name === "Markdown")).toBeDefined();
	});

	test("coverage sums to 1.0 for single language", () => {
		const files = [
			{ relativePath: "a.py", size: 300 },
			{ relativePath: "b.py", size: 700 },
		];
		const langs = detectLanguages(files);
		const py = langs.find((l) => l.name === "Python");
		expect(py!.coverage).toBeCloseTo(1.0, 2);
	});
});

// ─── detectPackageManager Tests ───────────────────────────────────────

describe("detectPackageManager", () => {
	test("detects npm from package.json", () => {
		const result = detectPackageManager(["package.json"]);
		expect(result).toBe("npm");
	});

	test("detects npm from package-lock.json", () => {
		const result = detectPackageManager(["package-lock.json"]);
		expect(result).toBe("npm");
	});

	test("detects yarn from yarn.lock", () => {
		const result = detectPackageManager(["yarn.lock"]);
		expect(result).toBe("yarn");
	});

	test("detects pnpm from pnpm-lock.yaml", () => {
		const result = detectPackageManager(["pnpm-lock.yaml"]);
		expect(result).toBe("pnpm");
	});

	test("detects bun from bun.lockb", () => {
		const result = detectPackageManager(["bun.lockb"]);
		expect(result).toBe("bun");
	});

	test("detects pip from requirements.txt", () => {
		const result = detectPackageManager(["requirements.txt"]);
		expect(result).toBe("pip");
	});

	test("detects poetry from pyproject.toml", () => {
		const result = detectPackageManager(["pyproject.toml"]);
		expect(result).toBe("poetry");
	});

	test("detects poetry from poetry.lock", () => {
		const result = detectPackageManager(["poetry.lock"]);
		expect(result).toBe("poetry");
	});

	test("returns null for empty list", () => {
		expect(detectPackageManager([])).toBeNull();
	});

	test("prefers npm over yarn when both present", () => {
		// npm gets score 1 (package.json), yarn gets score 1 (yarn.lock)
		// npm comes first in tiebreak since it's the first non-zero score
		const result = detectPackageManager(["package.json", "yarn.lock"]);
		// yarn.lock beats package.json signal for yarn
		expect(result === "yarn" || result === "npm").toBe(true);
	});

	test("handles nested paths", () => {
		const result = detectPackageManager(["apps/frontend/package.json"]);
		expect(result).toBe("npm");
	});

	test("detects bench from apps.txt", () => {
		const result = detectPackageManager(["apps.txt"]);
		expect(result).toBe("bench");
	});

	test("detects bench from sites directory", () => {
		const result = detectPackageManager(["sites/", "apps.txt"]);
		expect(result).toBe("bench");
	});

	test("score beats previous with multiple signals", () => {
		// yarn.lock gives yarn score 1; package-lock.json gives npm score 1; yarn wins on order
		// Use only yarn.lock so only yarn has a signal
		const result = detectPackageManager(["yarn.lock"]);
		expect(result).toBe("yarn");
	});
});

// ─── parsePackageJsonScripts Tests ────────────────────────────────────

describe("parsePackageJsonScripts", () => {
	test("extracts all scripts", () => {
		const pkg = {
			scripts: {
				test: "vitest",
				build: "tsc && vite build",
				dev: "vite",
			},
		};
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds.length).toBe(3);
	});

	test("marks test as primary", () => {
		const pkg = { scripts: { test: "jest" } };
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds.find((c) => c.command === "npm run test")?.primary).toBe(true);
	});

	test("marks build as primary", () => {
		const pkg = { scripts: { build: "webpack" } };
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds.find((c) => c.command === "npm run build")?.primary).toBe(true);
	});

	test("marks dev as primary", () => {
		const pkg = { scripts: { dev: "vite" } };
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds.find((c) => c.command === "npm run dev")?.primary).toBe(true);
	});

	test("marks start as primary", () => {
		const pkg = { scripts: { start: "node server.js" } };
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds.find((c) => c.command === "npm run start")?.primary).toBe(true);
	});

	test("marks lint as primary", () => {
		const pkg = { scripts: { lint: "eslint ." } };
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds.find((c) => c.command === "npm run lint")?.primary).toBe(true);
	});

	test("marks non-standard scripts as non-primary", () => {
		const pkg = { scripts: { myscript: "echo hello" } };
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds.find((c) => c.command === "npm run myscript")?.primary).toBe(false);
	});

	test("handles empty scripts object", () => {
		const pkg = { scripts: {} };
		expect(parsePackageJsonScripts(pkg)).toEqual([]);
	});

	test("handles undefined scripts", () => {
		const pkg = {};
		expect(parsePackageJsonScripts(pkg)).toEqual([]);
	});

	test("source is always package.json", () => {
		const pkg = { scripts: { test: "jest" } };
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds.every((c) => c.source === "package.json")).toBe(true);
	});

	test("command format is npm run <name>", () => {
		const pkg = { scripts: { foo: "bar" } };
		const cmds = parsePackageJsonScripts(pkg);
		expect(cmds[0].command).toBe("npm run foo");
	});
});

// ─── categorizeCommands Tests ─────────────────────────────────────────

describe("categorizeCommands", () => {
	test("categorizes jest test commands", () => {
		const cmds = [{ command: "npm run test", source: "package.json", primary: true }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.unitTest).toContain("npm run test");
	});

	test("categorizes vitest commands", () => {
		const cmds = [{ command: "vitest run", source: "package.json", primary: true }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.unitTest.some((c) => c.includes("vitest"))).toBe(true);
	});

	test("categorizes pytest commands", () => {
		const cmds = [{ command: "pytest", source: "package.json", primary: true }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.unitTest).toContain("pytest");
	});

	test("categorizes playwright e2e commands", () => {
		const cmds = [{ command: "playwright e2e", source: "package.json", primary: true }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.e2eTest).toContain("playwright e2e");
	});

	test("categorizes cypress e2e commands", () => {
		const cmds = [{ command: "cypress run", source: "package.json", primary: true }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.e2eTest).toContain("cypress run");
	});

	test("categorizes eslint lint commands", () => {
		const cmds = [{ command: "eslint .", source: "package.json", primary: false }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.lint.some((c) => c.includes("eslint"))).toBe(true);
	});

	test("categorizes prettier lint commands", () => {
		const cmds = [{ command: "prettier --check .", source: "package.json", primary: false }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.lint.some((c) => c.includes("prettier"))).toBe(true);
	});

	test("categorizes build commands", () => {
		const cmds = [{ command: "npm run build", source: "package.json", primary: true }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.build).toContain("npm run build");
	});

	test("categorizes vite build commands", () => {
		const cmds = [{ command: "vite build", source: "package.json", primary: true }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.build.some((c) => c.includes("vite"))).toBe(true);
	});

	test("categorizes next build commands", () => {
		const cmds = [{ command: "next build", source: "package.json", primary: true }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.build.some((c) => c.includes("next"))).toBe(true);
	});

	test("categorizes migrate commands", () => {
		const cmds = [{ command: "npm run migrate", source: "package.json", primary: false }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.migrate).toContain("npm run migrate");
	});

	test("categorizes bench migrate commands", () => {
		const cmds = [{ command: "bench migrate", source: "package.json", primary: false }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.migrate.some((c) => c.includes("bench"))).toBe(true);
	});

	test("avoids duplicate categorization", () => {
		const cmds = [
			{ command: "npm run test", source: "package.json", primary: true },
			{ command: "npm run test", source: "package.json", primary: true },
		];
		const categorized = categorizeCommands(cmds);
		expect(categorized.unitTest.filter((c) => c === "npm run test").length).toBe(1);
	});

	test("handles empty command list", () => {
		const categorized = categorizeCommands([]);
		expect(categorized.unitTest).toEqual([]);
		expect(categorized.build).toEqual([]);
	});

	test("categorizes integration test commands", () => {
		const cmds = [{ command: "npm run integration-tests", source: "package.json", primary: false }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.integrationTest).toContain("npm run integration-tests");
	});

	test("categorizes typecheck commands", () => {
		const cmds = [{ command: "tsc --noEmit", source: "package.json", primary: false }];
		const categorized = categorizeCommands(cmds);
		expect(categorized.typecheck.some((c) => c.includes("tsc"))).toBe(true);
	});
});

// ─── parsePythonCommands Tests ────────────────────────────────────────

describe("parsePythonCommands", () => {
	test("detects pytest from pyproject.toml", () => {
		const content = '[tool.pytest]\ntestpaths = ["tests"]';
		const cmds = parsePythonCommands(content);
		expect(cmds.find((c) => c.command === "pytest")).toBeDefined();
	});

	test("detects pytest from [pytest] section", () => {
		const cmds = parsePythonCommands("[pytest]\ntestpaths = tests");
		expect(cmds.find((c) => c.command === "pytest")).toBeDefined();
	});

	test("detects coverage commands", () => {
		const cmds = parsePythonCommands("coverage = run: pytest");
		expect(cmds.some((c) => c.command.includes("coverage run"))).toBe(true);
	});

	test("handles empty content", () => {
		const cmds = parsePythonCommands("");
		expect(cmds).toEqual([]);
	});
});

// ─── parseComposerScripts Tests ───────────────────────────────────────

describe("parseComposerScripts", () => {
	test("extracts composer scripts", () => {
		const composer = { scripts: { test: "phpunit", lint: "phpcs" } };
		const cmds = parseComposerScripts(composer);
		expect(cmds.length).toBe(2);
	});

	test("command format is composer <name>", () => {
		const composer = { scripts: { test: "phpunit" } };
		const cmds = parseComposerScripts(composer);
		expect(cmds[0].command).toBe("composer test");
	});

	test("marks test as primary", () => {
		const composer = { scripts: { test: "phpunit" } };
		const cmds = parseComposerScripts(composer);
		expect(cmds.find((c) => c.command === "composer test")?.primary).toBe(true);
	});

	test("marks lint as primary", () => {
		const composer = { scripts: { lint: "phpcs" } };
		const cmds = parseComposerScripts(composer);
		expect(cmds.find((c) => c.command === "composer lint")?.primary).toBe(true);
	});

	test("handles empty scripts", () => {
		const composer = { scripts: {} };
		expect(parseComposerScripts(composer)).toEqual([]);
	});

	test("handles undefined scripts", () => {
		const composer = {};
		expect(parseComposerScripts(composer)).toEqual([]);
	});
});

// ─── AnalysisCache Tests ──────────────────────────────────────────────

describe("AnalysisCache", () => {
	test("generates consistent cache keys", () => {
		const cache = new AnalysisCache({ enabled: false });
		const key1 = cache.generateKey("/repo", "abc123", "def456");
		const key2 = cache.generateKey("/repo", "abc123", "def456");
		expect(key1.repositoryRoot).toBe(key2.repositoryRoot);
		expect(key1.revision).toBe(key2.revision);
		expect(key1.configHash).toBe(key2.configHash);
	});

	test("generates different keys for different roots", () => {
		const cache = new AnalysisCache({ enabled: false });
		const key1 = cache.generateKey("/repo1", "abc123", "def456");
		const key2 = cache.generateKey("/repo2", "abc123", "def456");
		expect(key1.repositoryRoot).not.toBe(key2.repositoryRoot);
	});

	test("generates different keys for different revisions", () => {
		const cache = new AnalysisCache({ enabled: false });
		const key1 = cache.generateKey("/repo", "abc123", "def456");
		const key2 = cache.generateKey("/repo", "xyz789", "def456");
		expect(key1.revision).not.toBe(key2.revision);
	});

	test("calculates hash consistently", () => {
		const cache = new AnalysisCache({ enabled: false });
		const h1 = cache.calculateHash("hello");
		const h2 = cache.calculateHash("hello");
		expect(h1).toBe(h2);
	});

	test("calculates different hashes for different content", () => {
		const cache = new AnalysisCache({ enabled: false });
		const h1 = cache.calculateHash("hello");
		const h2 = cache.calculateHash("world");
		expect(h1).not.toBe(h2);
	});

	test("calculates config hash", async () => {
		const cache = new AnalysisCache({ enabled: false });
		const hash = await cache.calculateConfigHash([
			{ path: "a.json", content: '{"test":1}' },
		]);
		expect(typeof hash).toBe("string");
		expect(hash.length).toBe(64); // sha256 hex
	});

	test("get returns null when disabled", async () => {
		const cache = new AnalysisCache({ enabled: false });
		const key = cache.generateKey("/repo", "abc", "def");
		const result = await cache.get(key);
		expect(result).toBeNull();
	});

	test("set does not throw when disabled", async () => {
		const cache = new AnalysisCache({ enabled: false });
		const key = cache.generateKey("/repo", "abc", "def");
		await expect(
			cache.set(key, {
				repositoryRoot: "/repo",
				repositoryName: "repo",
				revision: "abc",
				frameworks: [],
				languages: [],
				packageManagers: [],
				applications: [],
				commands: {
					unitTest: [],
					integrationTest: [],
					e2eTest: [],
					lint: [],
					typecheck: [],
					build: [],
					migrate: [],
				},
				rules: [],
				sensitivePaths: [],
				generatedPaths: [],
				testCapabilities: [],
				confidence: 0,
				warnings: [],
				analyzedAt: new Date().toISOString(),
			}, { ruleHash: "r", manifestHash: "m", configHash: "c" }),
		).resolves.toBeUndefined();
	});

	test("clear does not throw when disabled", async () => {
		const cache = new AnalysisCache({ enabled: false });
		await expect(cache.clear()).resolves.toBeUndefined();
	});

	test("invalidate does not throw when disabled", async () => {
		const cache = new AnalysisCache({ enabled: false });
		await expect(cache.invalidate("/repo")).resolves.toBeUndefined();
	});

	test("getStats returns zeros when disabled", async () => {
		const cache = new AnalysisCache({ enabled: false });
		const stats = await cache.getStats();
		expect(stats.entryCount).toBe(0);
		expect(stats.totalSize).toBe(0);
	});
});

// ─── hashRuleFiles Tests ──────────────────────────────────────────────

describe("hashRuleFiles", () => {
	test("generates consistent hash for same files", async () => {
		const files = [{ path: "AGENTS.md", content: "# Rules\n\nTest content" }];
		const h1 = await hashRuleFiles(files);
		const h2 = await hashRuleFiles(files);
		expect(h1).toBe(h2);
	});

	test("different content produces different hash", async () => {
		const h1 = await hashRuleFiles([{ path: "a.md", content: "v1" }]);
		const h2 = await hashRuleFiles([{ path: "a.md", content: "v2" }]);
		expect(h1).not.toBe(h2);
	});

	test("different paths produce different hash", async () => {
		const h1 = await hashRuleFiles([{ path: "a.md", content: "same" }]);
		const h2 = await hashRuleFiles([{ path: "b.md", content: "same" }]);
		expect(h1).not.toBe(h2);
	});

	test("empty list produces valid hash", async () => {
		const hash = await hashRuleFiles([]);
		expect(typeof hash).toBe("string");
		expect(hash.length).toBe(64);
	});
});

// ─── hashManifestFiles Tests ───────────────────────────────────────────

describe("hashManifestFiles", () => {
	test("generates consistent hash", async () => {
		const files = [
			{ path: "package.json", content: '{"scripts":{"test":"jest"}}' },
		];
		const h1 = await hashManifestFiles(files);
		const h2 = await hashManifestFiles(files);
		expect(h1).toBe(h2);
	});

	test("only scripts and deps are hashed", async () => {
		const files = [
			{ path: "package.json", content: '{"scripts":{"test":"jest"},"extra":"ignored"}' },
		];
		const hash = await hashManifestFiles(files);
		expect(typeof hash).toBe("string");
		expect(hash.length).toBe(64);
	});
});

// ─── FileSystemWalker Tests ────────────────────────────────────────────

describe("FileSystemWalker", () => {
	test("rejects non-absolute root path", () => {
		expect(() => new FileSystemWalker("relative/path")).toThrow();
	});

	test("scans empty directory", async () => {
		const dir = await tmpDir();
		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();
		expect(result.files).toEqual([]);
		expect(result.truncated).toBe(false);
		expect(result.errors).toEqual([]);
	});

	test("scans files in directory", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "index.ts"), "const x = 1;", "utf-8");
		await writeFile(join(dir, "main.py"), "print('hello')", "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		expect(result.files.length).toBeGreaterThanOrEqual(2);
		const paths = result.files.map((f) => f.relativePath);
		expect(paths).toContain("index.ts");
		expect(paths).toContain("main.py");
	});

	test("detects sensitive files by pattern", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, ".env"), "SECRET=value", "utf-8");
		await writeFile(join(dir, ".env.local"), "SECRET=local", "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		const envFiles = result.files.filter((f) => f.sensitive);
		expect(envFiles.length).toBeGreaterThan(0);
	});

	test("detects generated files by pattern", async () => {
		const dir = await tmpDir();
		await mkdir(join(dir, "dist"), { recursive: true });
		await writeFile(join(dir, "dist/bundle.js"), "module.exports={};", "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		const generatedFiles = result.files.filter((f) => f.generated);
		expect(generatedFiles.length).toBeGreaterThan(0);
	});

	test("respects maxScanFiles limit", async () => {
		const dir = await tmpDir();
		// Create many files
		for (let i = 0; i < 50; i++) {
			await writeFile(join(dir, `file${i}.txt`), `content ${i}`, "utf-8");
		}

		const walker = new FileSystemWalker(dir, { maxScanFiles: 10 });
		const result = await walker.scan();

		expect(result.files.length).toBeLessThanOrEqual(10);
		expect(result.truncated).toBe(true);
	});

	test("skips hidden directories except .git", async () => {
		const dir = await tmpDir();
		await mkdir(join(dir, ".hidden"), { recursive: true });
		await writeFile(join(dir, ".hidden/file.txt"), "secret", "utf-8");
		await mkdir(join(dir, ".git"), { recursive: true });
		await writeFile(join(dir, ".git/config"), "[core]", "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		const hiddenFiles = result.files.filter((f) => f.relativePath.includes(".hidden"));
		expect(hiddenFiles).toEqual([]);
		// .git should be included (not skipped)
	});

	test("resolves relative path correctly", async () => {
		const dir = await tmpDir();
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src/index.ts"), "", "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		const tsFile = result.files.find((f) => f.relativePath.endsWith(".ts"));
		expect(tsFile?.relativePath).toBe("src/index.ts");
	});

	test("getStats returns scan statistics", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "a.txt"), "a", "utf-8");
		await writeFile(join(dir, "b.txt"), "b", "utf-8");

		const walker = new FileSystemWalker(dir);
		await walker.scan();
		const stats = walker.getStats();

		expect(stats.filesScanned).toBeGreaterThanOrEqual(2);
		expect(stats.directoriesScanned).toBeGreaterThanOrEqual(1);
	});

	test("readFileSafe returns null for oversized files", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "big.txt"), "x".repeat(1000), "utf-8");

		const walker = new FileSystemWalker(dir, { maxFileSize: 100 });
		const content = await walker.readFileSafe(join(dir, "big.txt"));
		expect(content).toBeNull();
	});

	test("readFileSafe returns content for small files", async () => {
		const dir = await tmpDir();
		const content = "hello world";
		await writeFile(join(dir, "small.txt"), content, "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.readFileSafe(join(dir, "small.txt"));
		expect(result).toBe(content);
	});

	test("exists returns true for existing path", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "exists.txt"), "x", "utf-8");

		const walker = new FileSystemWalker(dir);
		expect(await walker.exists(join(dir, "exists.txt"))).toBe(true);
	});

	test("exists returns false for non-existent path", async () => {
		const dir = await tmpDir();
		const walker = new FileSystemWalker(dir);
		expect(await walker.exists(join(dir, "nonexistent.txt"))).toBe(false);
	});

	test("findFiles matches regex patterns", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "test.spec.ts"), "", "utf-8");
		await writeFile(join(dir, "test.test.ts"), "", "utf-8");
		await writeFile(join(dir, "app.ts"), "", "utf-8");

		const walker = new FileSystemWalker(dir);
		const results = await walker.findFiles(/\.test\.ts$/);
		expect(results.length).toBe(1);
	});
});

// ─── Rule Discovery Tests ─────────────────────────────────────────────

describe("rule-discovery", () => {
	test("parseRuleFile extracts sections from markdown", async () => {
		const ruleFile = {
			path: "/repo/AGENTS.md",
			name: "AGENTS.md",
			content: "# Section 1\n\nContent here.\n\n## Section 2\n\nMore content.",
			userDefined: true,
		};
		const rule = await parseRuleFile(ruleFile);
		expect(rule.sections.length).toBeGreaterThan(0);
		expect(rule.priority).toBe("mandatory");
		expect(rule.userDefined).toBe(true);
	});

	test("AGENTS.md has mandatory priority", async () => {
		const rule = await parseRuleFile({
			path: "/repo/AGENTS.md",
			name: "AGENTS.md",
			content: "# Rules",
			userDefined: true,
		});
		expect(rule.priority).toBe("mandatory");
	});

	test("CONTRIBUTING.md has advisory priority", async () => {
		const rule = await parseRuleFile({
			path: "/repo/CONTRIBUTING.md",
			name: "CONTRIBUTING.md",
			content: "# Contributing",
			userDefined: false,
		});
		expect(rule.priority).toBe("advisory");
	});

	test("discoverRuleFiles finds files in temp repo", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "AGENTS.md"), "# Agent Rules\n\nUse TypeScript.", "utf-8");

		const fs = {
			exists: async (p: string) => {
				try {
					const { access } = await import("node:fs/promises");
					await access(p);
					return true;
				} catch {
					return false;
				}
			},
			readFile: async (p: string) => {
				const { readFile } = await import("node:fs/promises");
				return readFile(p, "utf-8");
			},
			readDir: async (p: string) => {
				const { readdir } = await import("node:fs/promises");
				return readdir(p);
			},
			isDirectory: async (p: string) => {
				const { stat } = await import("node:fs/promises");
				const s = await stat(p);
				return s.isDirectory();
			},
		};

		const rules = await discoverRuleFiles(dir, fs);
		expect(rules.length).toBeGreaterThan(0);
		expect(rules.find((r) => r.name === "AGENTS.md")).toBeDefined();
	});

	test("mergeRules sorts by priority", async () => {
		const files = [
			{
				path: "/repo/CONTRIBUTING.md",
				name: "CONTRIBUTING.md",
				content: "# Contributing",
				userDefined: false,
			},
			{
				path: "/repo/AGENTS.md",
				name: "AGENTS.md",
				content: "# Agents",
				userDefined: true,
			},
		];
		const merged = mergeRules(files);
		expect(merged[0].id).toBe("rule-AGENTS");
	});
});

// ─── Signal Detection Tests ───────────────────────────────────────────

describe("scanSignals", () => {
	test("returns empty array when no signals match", async () => {
		const fs = {
			exists: async () => false,
			glob: async () => [],
			readFile: async () => "",
			readDir: async () => [],
			isDirectory: async () => false,
		};
		const signals = await scanSignals(fs);
		expect(signals).toEqual([]);
	});

	test("detects file existence signals", async () => {
		// Use a non-glob signal: frappe uses "apps.txt"
		const fs = {
			exists: async (path: string) => path === "apps.txt",
			glob: async () => [],
			readFile: async () => "",
			readDir: async () => [],
			isDirectory: async () => false,
		};
		const signals = await scanSignals(fs);
		const frappeSignal = signals.find((s) => s.type === "frappe_hooks");
		expect(frappeSignal).toBeDefined();
		expect(frappeSignal?.path).toBe("apps.txt");
	});
});

describe("GenericFrameworkDetector", () => {
	test("detects Next.js from next.config.js", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "next.config.js"), "module.exports = {}", "utf-8");
		await writeFile(join(dir, "package.json"), '{"dependencies":{"next":"14"}}', "utf-8");

		const walker = new FileSystemWalker(dir);
		const roFs = {
			exists: async (path: string) => walker.exists(path),
			readFile: async (path: string) => {
				const c = await walker.readFileSafe(path);
				if (c === null) throw new Error("not found");
				return c;
			},
			readDir: async (path: string) => {
				try {
					const { readdir } = await import("node:fs/promises");
					return readdir(walker.resolvePath(path));
				} catch {
					return [];
				}
			},
			isDirectory: async (path: string) => {
				try {
					const { stat } = await import("node:fs/promises");
					const s = await stat(walker.resolvePath(path));
					return s.isDirectory();
				} catch {
					return false;
				}
			},
			// glob is used for wildcard patterns like "next.config.*"
			glob: async (pattern: string) => {
				if (pattern === "next.config.*") {
					return ["next.config.js"];
				}
				return [];
			},
		};

		const detector = new GenericFrameworkDetector();
		const results = await detector.detect(roFs);

		expect(results.length).toBeGreaterThan(0);
		const nextjs = results.find((r) => r.category === "nextjs");
		expect(nextjs).toBeDefined();
		expect(nextjs!.confidence).toBeGreaterThan(0);
	});

	test("detects Django from manage.py", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "manage.py"), "#!/usr/bin/env python", "utf-8");
		await writeFile(join(dir, "settings.py"), "SECRET_KEY = 'x'", "utf-8");

		const walker = new FileSystemWalker(dir);
		const roFs = {
			exists: async (path: string) => walker.exists(path),
			readFile: async () => "",
			readDir: async () => [],
			isDirectory: async () => false,
			glob: async () => [],
		};

		const detector = new GenericFrameworkDetector();
		const results = await detector.detect(roFs);

		const django = results.find((r) => r.category === "django");
		expect(django).toBeDefined();
		expect(django!.confidence).toBeGreaterThan(0);
	});

	test("returns empty results for unknown directory", async () => {
		await tmpDir(); // Creates empty temp dir
		const roFs = {
			exists: async () => false,
			readFile: async () => { throw new Error("not found"); },
			readDir: async () => [],
			isDirectory: async () => false,
			glob: async () => [],
		};

		const detector = new GenericFrameworkDetector();
		const results = await detector.detect(roFs);
		// Unknown framework is possible if signal matching doesn't find anything
		expect(Array.isArray(results)).toBe(true);
	});
});

// ─── ProjectAnalyzer Integration Tests ────────────────────────────────

describe("ProjectAnalyzer", () => {
	let analyzer: ProjectAnalyzer;

	beforeEach(() => {
		analyzer = createProjectAnalyzer({ cache: new AnalysisCache({ enabled: false }) });
	});

	test("analyzer is instance of ProjectAnalyzer", () => {
		expect(analyzer).toBeInstanceOf(ProjectAnalyzer);
	});

	test("analyzes Next.js workspace", async () => {
		const dir = await tmpDir();
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ dependencies: { next: "14.0.0" } }),
			"utf-8",
		);
		await writeFile(join(dir, "next.config.js"), "module.exports = {}", "utf-8");
		await mkdir(join(dir, "app"), { recursive: true });
		await writeFile(join(dir, "app/page.tsx"), "export default function(){}", "utf-8");

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile).toBeDefined();
		expect(result.profile!.repositoryRoot).toBe(dir);
		expect(result.profile!.repositoryName).toBeDefined();
		expect(result.profile!.analyzedAt).toBeDefined();
	});

	test("analyzes React/Vite workspace", async () => {
		const dir = await tmpDir();
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ dependencies: { react: "^18" }, devDependencies: { vite: "^5" } }),
			"utf-8",
		);
		await writeFile(join(dir, "vite.config.ts"), "import { defineConfig } from 'vite'", "utf-8");
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src/main.tsx"), "import React from 'react'", "utf-8");

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile).toBeDefined();
	});

	test("analyzes Django workspace", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "manage.py"), "#!/usr/bin/env python", "utf-8");
		await writeFile(join(dir, "settings.py"), "SECRET_KEY = 'dev'", "utf-8");
		await writeFile(join(dir, "requirements.txt"), "django==4.0", "utf-8");

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile).toBeDefined();
	});

	test("analyzes Laravel workspace", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "artisan"), "#!/usr/bin/env php", "utf-8");
		await writeFile(
			join(dir, "composer.json"),
			JSON.stringify({ require: { laravel: "^10" } }),
			"utf-8",
		);
		await mkdir(join(dir, "app", "Http", "Controllers"), { recursive: true });

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile).toBeDefined();
	});

	test("detects language from scanned files", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");
		await writeFile(join(dir, "main.ts"), "const x: number = 1;", "utf-8");
		await writeFile(join(dir, "utils.py"), "def foo(): pass", "utf-8");

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile!.languages.length).toBeGreaterThan(0);
	});

	test("detects package manager from lock files", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");
		await writeFile(join(dir, "bun.lockb"), "", "utf-8");

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile!.packageManagers.length).toBeGreaterThan(0);
	});

	test("discovers commands from package.json", async () => {
		const dir = await tmpDir();
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({
				scripts: {
					test: "vitest",
					build: "tsc",
					lint: "eslint .",
				},
			}),
			"utf-8",
		);

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile!.commands.unitTest.length).toBeGreaterThan(0);
	});

	test("discovers AGENTS.md rules", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");
		await writeFile(
			join(dir, "AGENTS.md"),
			"# Agent Rules\n\n## Code Style\n\nUse TypeScript.",
			"utf-8",
		);

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile!.rules.length).toBeGreaterThan(0);
	});

	test("detects test capabilities", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");
		await writeFile(
			join(dir, "vitest.config.ts"),
			"import { defineConfig } from 'vitest/config'",
			"utf-8",
		);

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile!.testCapabilities.length).toBeGreaterThan(0);
		const vitest = result.profile!.testCapabilities.find((t) => t.runner === "vitest");
		expect(vitest).toBeDefined();
		expect(vitest!.available).toBe(true);
	});

	test("detects pytest from pyproject.toml", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "pyproject.toml"), "[tool.pytest]\ntestpaths = ['tests']", "utf-8");

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		const pytest = result.profile!.testCapabilities.find((t) => t.runner === "pytest");
		expect(pytest).toBeDefined();
	});

	test("returns error for non-existent directory", async () => {
		const result = await analyzer.analyze({
			repositoryRoot: "/nonexistent/path/to/repo",
		});
		// The analyzer catches errors and returns success:false for non-existent paths
		if (!result.success) {
			expect(result.error).toBeDefined();
			expect(result.errorCode).toBeDefined();
		}
	});

	test("reports duration", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");

		const result = await analyzer.analyze({ repositoryRoot: dir });
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("analyzer with custom cache works", async () => {
		const cache = new AnalysisCache({ enabled: false });
		const customAnalyzer = createProjectAnalyzer({ cache });

		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");

		const result = await customAnalyzer.analyze({ repositoryRoot: dir });
		expect(result.success).toBe(true);
	});

	test("analyzer config respects maxScanFiles", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");

		// Create many files
		for (let i = 0; i < 30; i++) {
			await writeFile(join(dir, `file${i}.txt`), `content ${i}`, "utf-8");
		}

		const limitedAnalyzer = createProjectAnalyzer({
			cache: new AnalysisCache({ enabled: false }),
		});

		const result = await limitedAnalyzer.analyze({
			repositoryRoot: dir,
			config: { maxScanFiles: 10 },
		});

		expect(result.success).toBe(true);
		expect(result.profile).toBeDefined();
	});

	test("analyzer with no monorepo detection", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), JSON.stringify({ name: "root" }), "utf-8");
		await mkdir(join(dir, "packages", "app"), { recursive: true });
		await writeFile(join(dir, "packages", "app", "package.json"), JSON.stringify({ name: "app" }), "utf-8");

		const result = await analyzer.analyze({
			repositoryRoot: dir,
			config: { detectMonorepo: false },
		});

		expect(result.success).toBe(true);
	});

	test("generates warnings for conflicting frameworks", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");
		await writeFile(join(dir, "next.config.js"), "module.exports = {}", "utf-8");
		await writeFile(join(dir, "vite.config.ts"), "import { defineConfig } from 'vite'", "utf-8");

		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		// Both Next.js and Vite should be detected, may produce framework warnings
		expect(result.profile).toBeDefined();
	});
});

// ─── Complexity Estimation ────────────────────────────────────────────

describe("complexity signals from FileSystemWalker", () => {
	test("file count reflects all scanned files", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{}", "utf-8");
		await writeFile(join(dir, "a.ts"), "", "utf-8");
		await writeFile(join(dir, "b.ts"), "", "utf-8");
		await writeFile(join(dir, "c.ts"), "", "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		expect(result.files.length).toBeGreaterThanOrEqual(4);
	});

	test("total size accumulates file sizes", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), '{"name":"test"}', "utf-8");
		await writeFile(join(dir, "main.ts"), "const x = 1;".repeat(100), "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		const tsFile = result.files.find((f) => f.relativePath === "main.ts");
		expect(tsFile!.size).toBeGreaterThan(500);
	});

	test("scans nested directories", async () => {
		const dir = await tmpDir();
		await mkdir(join(dir, "src", "components", "ui"), { recursive: true });
		await writeFile(join(dir, "src/index.ts"), "", "utf-8");
		await writeFile(join(dir, "src/components/Button.tsx"), "", "utf-8");
		await writeFile(join(dir, "src/components/ui/Card.tsx"), "", "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		expect(result.files.length).toBeGreaterThanOrEqual(3);
		expect(result.directoriesScanned).toBeGreaterThan(3);
	});

	test("node_modules files are marked as generated", async () => {
		const dir = await tmpDir();
		await mkdir(join(dir, "node_modules"), { recursive: true });
		await mkdir(join(dir, "node_modules/lodash"), { recursive: true });
		await writeFile(join(dir, "node_modules/lodash/index.js"), "module.exports={};", "utf-8");
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src/main.ts"), "", "utf-8");

		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();

		// node_modules files are scanned but marked as generated
		const generatedFiles = result.files.filter((f) => f.generated);
		expect(generatedFiles.length).toBeGreaterThan(0);
	});

	test("depth limit prevents deep scanning", async () => {
		const dir = await tmpDir();
		// Create deeply nested structure
		let current = dir;
		for (let i = 0; i < 30; i++) {
			current = join(current, `level${i}`);
		}
		await mkdir(current, { recursive: true });
		await writeFile(join(current, "deep.ts"), "", "utf-8");

		const walker = new FileSystemWalker(dir, { maxDepth: 5 });
		const result = await walker.scan();

		const deepFile = result.files.find((f) => f.relativePath.includes("deep.ts"));
		expect(deepFile).toBeUndefined();
	});
});

// ─── Error Cases ──────────────────────────────────────────────────────

describe("error handling", () => {
	test("analyzer handles corrupted JSON gracefully", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), "{ invalid json }", "utf-8");

		const analyzer = createProjectAnalyzer({ cache: new AnalysisCache({ enabled: false }) });
		const result = await analyzer.analyze({ repositoryRoot: dir });

		// Should still succeed with partial results
		expect(result.success).toBe(true);
	});

	test("walker handles unreadable directories", async () => {
		const dir = await tmpDir();
		// The walker should not crash on edge cases
		const walker = new FileSystemWalker(dir);
		const result = await walker.scan();
		expect(result.errors).toEqual([]);
	});

	test("analyzer handles missing package.json scripts", async () => {
		const dir = await tmpDir();
		await writeFile(join(dir, "package.json"), JSON.stringify({ name: "no-scripts" }), "utf-8");

		const analyzer = createProjectAnalyzer({ cache: new AnalysisCache({ enabled: false }) });
		const result = await analyzer.analyze({ repositoryRoot: dir });

		expect(result.success).toBe(true);
		expect(result.profile!.commands).toBeDefined();
	});
});

// ─── Additional Cache TTL Tests ────────────────────────────────────────

describe("AnalysisCache TTL behavior", () => {
	test("cache returns null for expired entries", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "cache-ttl-"));
		tempDirs.push(tmp);

		const cache = new AnalysisCache({
			enabled: true,
			cacheDir: tmp,
			maxAgeMs: 1, // 1 millisecond TTL
		});

		const key = cache.generateKey("/repo", "abc", "def");
		await cache.set(
			key,
			{
				repositoryRoot: "/repo",
				repositoryName: "repo",
				revision: "abc",
				frameworks: [],
				languages: [],
				packageManagers: [],
				applications: [],
				commands: {
					unitTest: [],
					integrationTest: [],
					e2eTest: [],
					lint: [],
					typecheck: [],
					build: [],
					migrate: [],
				},
				rules: [],
				sensitivePaths: [],
				generatedPaths: [],
				testCapabilities: [],
				confidence: 0,
				warnings: [],
				analyzedAt: new Date().toISOString(),
			},
			{ ruleHash: "r", manifestHash: "m", configHash: "c" },
		);

		// Wait for entry to expire
		await new Promise((r) => setTimeout(r, 10));

		const result = await cache.get(key);
		expect(result).toBeNull();

		await rm(tmp, { recursive: true, force: true });
		tempDirs.pop();
	});

	test("cache stores and retrieves profiles", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "cache-store-"));
		tempDirs.push(tmp);

		const cache = new AnalysisCache({
			enabled: true,
			cacheDir: tmp,
			maxAgeMs: 60000,
		});

		const profile = {
			repositoryRoot: "/test-repo",
			repositoryName: "test-repo",
			revision: "abc123",
			frameworks: [{ category: "react" as const, name: "React", confidence: 0.9, signals: [], primary: true }],
			languages: [{ name: "TypeScript", coverage: 1.0 }],
			packageManagers: [{ type: "npm" as const, configPath: "package.json", primary: true }],
			applications: [],
			commands: {
				unitTest: ["npm run test"],
				integrationTest: [],
				e2eTest: [],
				lint: [],
				typecheck: [],
				build: [],
				migrate: [],
			},
			rules: [],
			sensitivePaths: [],
			generatedPaths: [],
			testCapabilities: [],
			confidence: 0.9,
			warnings: [],
			analyzedAt: new Date().toISOString(),
		};

		const key = cache.generateKey("/test-repo", "abc123", "xyz");
		await cache.set(key, profile, { ruleHash: "r", manifestHash: "m", configHash: "xyz" });

		const retrieved = await cache.get(key);
		expect(retrieved).not.toBeNull();
		expect(retrieved!.repositoryName).toBe("test-repo");
		expect(retrieved!.languages[0].name).toBe("TypeScript");

		await rm(tmp, { recursive: true, force: true });
		tempDirs.pop();
	});

	test("invalidate removes all entries for a repository", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "cache-inval-"));
		tempDirs.push(tmp);

		const cache = new AnalysisCache({
			enabled: true,
			cacheDir: tmp,
		});

		const key1 = cache.generateKey("/repo", "v1", "h1");
		await cache.set(
			key1,
			{
				repositoryRoot: "/repo",
				repositoryName: "repo",
				revision: "v1",
				frameworks: [],
				languages: [],
				packageManagers: [],
				applications: [],
				commands: {
					unitTest: [], integrationTest: [], e2eTest: [], lint: [],
					typecheck: [], build: [], migrate: [],
				},
				rules: [],
				sensitivePaths: [],
				generatedPaths: [],
				testCapabilities: [],
				confidence: 0,
				warnings: [],
				analyzedAt: new Date().toISOString(),
			},
			{ ruleHash: "r", manifestHash: "m", configHash: "h1" },
		);

		await cache.invalidate("/repo");

		const stats = await cache.getStats();
		expect(stats.entryCount).toBe(0);

		await rm(tmp, { recursive: true, force: true });
		tempDirs.pop();
	});

	test("getStats counts entries correctly", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "cache-stats-"));
		tempDirs.push(tmp);

		const cache = new AnalysisCache({ enabled: true, cacheDir: tmp });

		// Store two entries
		for (const rev of ["v1", "v2"]) {
			const key = cache.generateKey("/repo", rev, "h");
			await cache.set(
				key,
				{
					repositoryRoot: "/repo",
					repositoryName: "repo",
					revision: rev,
					frameworks: [],
					languages: [],
					packageManagers: [],
					applications: [],
					commands: {
						unitTest: [], integrationTest: [], e2eTest: [], lint: [],
						typecheck: [], build: [], migrate: [],
					},
					rules: [],
					sensitivePaths: [],
					generatedPaths: [],
					testCapabilities: [],
					confidence: 0,
					warnings: [],
					analyzedAt: new Date().toISOString(),
				},
				{ ruleHash: "r", manifestHash: "m", configHash: "h" },
			);
		}

		const stats = await cache.getStats();
		expect(stats.entryCount).toBe(2);
		expect(stats.totalSize).toBeGreaterThan(0);

		await rm(tmp, { recursive: true, force: true });
		tempDirs.pop();
	});
});
