/**
 * The review scope.
 *
 * The scope is the diff of the task, never the whole repository. A workspace
 * without Git has no honest scope, so nothing is reviewed.
 */

import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	chunkScope,
	collectScope,
	countModules,
	currentRevision,
	isGitRepository,
	isReviewablePath,
	moduleKey,
	parseNumstat,
	shouldChunkScope,
} from "../src/scope.js";
import { withPlainTempDir, withTempDir } from "./helpers.js";

function git(root: string, ...args: string[]): void {
	// The ambient Git configuration must not decide whether the fixture works:
	// a global identity, a signing key or a hook would break the commit.
	try {
		execFileSync(
			"git",
			[
				"-c",
				"user.email=test@example.com",
				"-c",
				"user.name=Test",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"core.hooksPath=/dev/null",
				...args,
			],
			{ cwd: root, stdio: "pipe" },
		);
	} catch (error) {
		const detail = error as { stderr?: Buffer; status?: number; signal?: string; message?: string };
		const stderr = detail.stderr?.toString() ?? "";
		throw new Error(
			`git ${args.join(" ")} failed in ${root}: status=${detail.status} signal=${detail.signal} message=${detail.message} stderr=${stderr}`,
		);
	}
}

/** A fresh Git repository with one commit. */
function withRepository(body: (root: string) => void): void {
	withTempDir("scope", (root) => {
		git(root, "init", "-q");
		body(root);
	});
}

describe("isReviewablePath", () => {
	it("keeps the source files", () => {
		expect(isReviewablePath("packages/notification/src/index.ts")).toBe(true);
		expect(isReviewablePath("index.ts")).toBe(true);
	});

	it("drops the build output", () => {
		expect(isReviewablePath("dist/index.js")).toBe(false);
		expect(isReviewablePath("node_modules/x/index.js")).toBe(false);
		expect(isReviewablePath("coverage/lcov.info")).toBe(false);
	});

	it("drops the build output of a nested module", () => {
		expect(isReviewablePath("packages/foo/dist/index.js")).toBe(false);
		expect(isReviewablePath("apps/x/coverage/lcov.info")).toBe(false);
		expect(isReviewablePath("services/x/vendor/lib.js")).toBe(false);
		expect(isReviewablePath("packages/foo/node_modules/x/index.js")).toBe(false);
	});
});

describe("moduleKey", () => {
	it("names the module of a file", () => {
		expect(moduleKey("packages/notification/src/index.ts")).toBe("packages/notification");
		expect(moduleKey("harness/wiki-integration.ts")).toBe("harness");
		expect(moduleKey("index.ts")).toBe("root");
	});
});

describe("collectScope", () => {
	it("reads the diff since the start revision", () => {
		withRepository((root) => {
			mkdirSync(join(root, "packages", "notification"), { recursive: true });
			writeFileSync(join(root, "packages", "notification", "index.ts"), "export const a = 1;\n");
			git(root, "add", "-A");
			git(root, "commit", "-qm", "base");
			const start = currentRevision(root);
			expect(start).toBeTruthy();

			writeFileSync(join(root, "packages", "notification", "index.ts"), "export const a = 2;\n");
			writeFileSync(join(root, "packages", "notification", "new.ts"), "export const b = 1;\n");

			const scope = collectScope(root, start);
			expect(scope.detected).toBe(true);
			expect(scope.files).toContain("packages/notification/index.ts");
			expect(scope.files).toContain("packages/notification/new.ts");
			expect(scope.metrics.files).toBe(2);
			expect(scope.metrics.modules).toBe(1);
		});
	});

	it("ignores the build output", () => {
		withRepository((root) => {
			mkdirSync(join(root, "dist"), { recursive: true });
			writeFileSync(join(root, "dist", "index.js"), "built\n");
			git(root, "add", "-A");
			git(root, "commit", "-qm", "base");
			const start = currentRevision(root);
			writeFileSync(join(root, "dist", "index.js"), "built again\n");

			const scope = collectScope(root, start);
			expect(scope.files).not.toContain("dist/index.js");
		});
	});

	it("reports no scope without Git", () => {
		withPlainTempDir("plain", (plain) => {
			expect(isGitRepository(plain)).toBe(false);
			const scope = collectScope(plain, null);
			expect(scope.detected).toBe(false);
			expect(scope.files).toEqual([]);
		});
	});

	it("reports no scope when the start revision is gone", () => {
		withRepository((root) => {
			// A missing baseline would silently reduce the scope to the last
			// commit, so the scope is empty instead of incomplete.
			const scope = collectScope(root, "0000000000000000000000000000000000000000");
			expect(scope.detected).toBe(false);
			expect(scope.files).toEqual([]);
			expect(scope.reason).toMatch(/does not exist/);
		});
	});
});

describe("parseNumstat", () => {
	it("adds the changed lines", () => {
		expect(parseNumstat("3\t1\tindex.ts\n0\t0\tother.ts\n")).toBe(4);
	});
});

describe("chunkScope", () => {
	it("splits the scope by module", () => {
		const chunks = chunkScope([
			"packages/notification/src/a.ts",
			"packages/notification/src/b.ts",
			"packages/jev-judge/src/c.ts",
		]);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.id).toBe("chunk-1");
		expect(chunks.map((chunk) => chunk.files.length)).toEqual([2, 1]);
	});

	it("splits a big module into several chunks", () => {
		const files = Array.from({ length: 7 }, (_, index) => `packages/x/src/file-${index}.ts`);
		const chunks = chunkScope(files, { maxFilesPerChunk: 3 });
		expect(chunks).toHaveLength(3);
		expect(chunks[2]?.files).toHaveLength(1);
	});

	it("returns nothing for an empty scope", () => {
		expect(chunkScope([])).toEqual([]);
	});
});

describe("countModules and shouldChunkScope", () => {
	it("counts the modules", () => {
		expect(countModules(["packages/a/x.ts", "packages/b/y.ts", "packages/a/z.ts"])).toBe(2);
	});

	it("measures the scope instead of assuming it", () => {
		expect(shouldChunkScope({ files: 3, modules: 1, changedLines: 100 })).toBe(false);
		expect(shouldChunkScope({ files: 20, modules: 1, changedLines: 100 })).toBe(true);
		expect(shouldChunkScope({ files: 3, modules: 5, changedLines: 100 })).toBe(true);
	});
});
