/**
 * Tests for release adapters
 * Run: node --test test/release-adapters.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

// ─── Test setup ────────────────────────────────────────────────────────────────

const TEST_DIR = join("/tmp", "release-adapter-tests");
const detectorPath = resolve(
	import.meta.dirname,
	"../scripts/release/adapters/detector.ts",
);
const repoRoot = resolve(import.meta.dirname, "..");

// Helper to create temp directory with specific files
function createTestRepo(files) {
	rmSync(TEST_DIR, { force: true, recursive: true });
	mkdirSync(TEST_DIR, { recursive: true });

	for (const [filename, content] of Object.entries(files)) {
		const filepath = join(TEST_DIR, filename);
		mkdirSync(resolve(filepath, ".."), { recursive: true });
		writeFileSync(filepath, content || "");
	}

	return TEST_DIR;
}

// ─── Detector tests ────────────────────────────────────────────────────────────

describe("Release Adapter Detector", () => {
	it("should detect Node.js workspace (package.json + workspaces)", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"package.json": JSON.stringify({ workspaces: ["packages/*"] }),
			"package-lock.json": "",
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		assert.ok(profile.stacks.length > 0, "Should detect stacks");
		assert.strictEqual(profile.unknown, false);
	});

	it("should detect Node.js workspace with yarn.lock", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"] }),
			"yarn.lock": "",
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		const nodeStack = profile.stacks.find((s) => s.id === "node-workspace");
		assert.ok(nodeStack, "Should detect Node.js");
		assert.ok(nodeStack.confidence >= 0.85, "Should have high confidence");
	});

	it("should detect Rust crate (Cargo.toml without Tauri)", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"Cargo.toml": '[package]\nname = "my-crate"',
			"Cargo.lock": "",
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		const rustStack = profile.stacks.find((s) => s.id === "rust");
		assert.ok(rustStack, "Should detect Rust stack");
		assert.ok(rustStack.confidence >= 0.9, "Rust should have high confidence");
	});

	it("should detect Tauri when src-tauri/Cargo.toml exists", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"src-tauri/Cargo.toml": '[package]\nname = "my-tauri-app"',
			"src-tauri/tauri.conf.json": '{"build": {}}',
			"package.json": "{}",
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		const tauriStack = profile.stacks.find((s) => s.id === "tauri");
		assert.ok(tauriStack, "Should detect Tauri stack");
		assert.ok(
			tauriStack.confidence >= 0.9,
			"Tauri should have high confidence",
		);
	});

	it("should detect Python package with pyproject.toml", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"pyproject.toml": '[project]\nname = "my-package"',
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		const pythonStack = profile.stacks.find((s) => s.id === "python");
		assert.ok(pythonStack, "Should detect Python stack");
		assert.strictEqual(
			pythonStack.confidence,
			0.95,
			"pyproject.toml should get 95%",
		);
	});

	it("should detect Python package with setup.py", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"setup.py": "from setuptools import setup",
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		const pythonStack = profile.stacks.find((s) => s.id === "python");
		assert.ok(pythonStack, "Should detect Python stack");
		assert.strictEqual(pythonStack.confidence, 0.85, "setup.py should get 85%");
	});

	it("should return unknown for empty directory", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		assert.strictEqual(profile.unknown, true, "Should be unknown");
		assert.strictEqual(profile.stacks.length, 0, "Should have no stacks");
	});

	it("should format profile with stacks", async () => {
		const detector = await import(detectorPath);

		const profile = {
			repoRoot: "/test",
			stacks: [
				{
					id: "node-workspace",
					name: "Node.js",
					confidence: 0.95,
					hints: ["package.json"],
				},
				{ id: "python", name: "Python", confidence: 0.5, hints: [] },
			],
			unknown: false,
		};

		const output = detector.formatProfile(profile);
		assert.ok(output.includes("Node.js"), "Should include stack name");
		assert.ok(output.includes("95%"), "Should include confidence");
		assert.ok(output.includes("hints:"), "Should include hints");
	});

	it("should format profile for unknown repos", async () => {
		const detector = await import(detectorPath);

		const profile = {
			repoRoot: "/empty",
			stacks: [],
			unknown: true,
		};

		const output = detector.formatProfile(profile);
		assert.ok(
			output.includes("No known stack detected"),
			"Should mention unknown",
		);
	});

	it("should rank stacks by confidence", async () => {
		const detector = await import(detectorPath);

		// Tauri has both Rust + Tauri hints
		const testRoot = createTestRepo({
			"src-tauri/Cargo.toml": '[package]\nname = "tauri"',
			"src-tauri/tauri.conf.json": "{}",
			"package.json": '{"workspaces": ["*"]}',
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		// First stack should have highest confidence
		for (let i = 1; i < profile.stacks.length; i++) {
			assert.ok(
				profile.stacks[i - 1].confidence >= profile.stacks[i].confidence,
				"Stacks should be sorted by confidence descending",
			);
		}
	});
});

// ─── Real repo tests ───────────────────────────────────────────────────────────

describe("Real repo detection", () => {
	it("should detect Node.js workspace for pi-harness-runtime", async () => {
		const detector = await import(detectorPath);

		const profile = detector.detectStacks({
			repoRoot,
			dryRun: false,
			verbose: false,
		});

		assert.ok(profile.stacks.length > 0, "Should detect stacks");
		const nodeStack = profile.stacks.find((s) => s.id === "node-workspace");
		assert.ok(nodeStack, "Should detect Node.js workspace");
	});

	it("should return correct bestAdapter for pi-harness-runtime", async () => {
		const detector = await import(detectorPath);

		const best = detector.bestAdapter({
			repoRoot,
			dryRun: false,
			verbose: false,
		});

		assert.ok(best, "Should return a best adapter");
		assert.strictEqual(best, "node-workspace", "Should be node-workspace");
	});
});

// ─── Orchestrator tests ────────────────────────────────────────────────────────

describe("Orchestrator exports", () => {
	it("should export detect function", async () => {
		const orchestrator = await import(
			resolve(import.meta.dirname, "../scripts/release/orchestrator.ts")
		);

		assert.strictEqual(
			typeof orchestrator.detect,
			"function",
			"Should export detect",
		);
		assert.strictEqual(
			typeof orchestrator.release,
			"function",
			"Should export release",
		);
	});

	it("should export ReleaseOptions interface shape", async () => {
		const orchestrator = await import(
			resolve(import.meta.dirname, "../scripts/release/orchestrator.ts")
		);

		// detect should accept options object
		const result = orchestrator.detect({ verbose: false });
		assert.strictEqual(typeof result, "string", "detect should return string");
		assert.ok(result.includes("Repo:"), "Should include repo label");
	});

	it("detect with verbose should include stack details", async () => {
		const orchestrator = await import(
			resolve(import.meta.dirname, "../scripts/release/orchestrator.ts")
		);

		const result = orchestrator.detect({ verbose: true, repoRoot });

		// Should show detection results
		assert.ok(
			result.includes("Detected stacks:"),
			"Should show detected stacks",
		);
	});
});

// ─── Adapter tests ─────────────────────────────────────────────────────────────

describe("Individual adapter detection", () => {
	it("should detect pnpm workspace", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"package.json": JSON.stringify({ workspaces: ["packages/*"] }),
			"pnpm-lock.yaml": "",
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		const nodeStack = profile.stacks.find((s) => s.id === "node-workspace");
		assert.ok(nodeStack, "Should detect Node.js with pnpm");
		assert.strictEqual(
			nodeStack.confidence,
			0.95,
			"pnpm should get 95% with lock file",
		);
	});

	it("should detect bun workspace", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"package.json": JSON.stringify({ workspaces: ["*"] }),
			"bun.lock": "",
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		const nodeStack = profile.stacks.find((s) => s.id === "node-workspace");
		assert.ok(nodeStack, "Should detect Node.js with bun");
	});

	it("should detect plain Node.js without workspaces", async () => {
		const detector = await import(detectorPath);

		const testRoot = createTestRepo({
			"package.json": JSON.stringify({ name: "my-app" }),
		});

		const profile = detector.detectStacks({
			repoRoot: testRoot,
			dryRun: false,
			verbose: false,
		});

		const nodeStack = profile.stacks.find((s) => s.id === "node-workspace");
		assert.ok(nodeStack, "Should detect plain Node.js");
		assert.strictEqual(
			nodeStack.confidence,
			0.7,
			"Plain Node.js should get 70%",
		);
	});
});

console.log("✓ Release adapter tests defined");
