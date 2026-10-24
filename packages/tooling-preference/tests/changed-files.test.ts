/**
 * The changed JavaScript/TypeScript files of a workspace.
 *
 * The detection reads the worktree of the session: a file that changed is
 * a file the check may read. A workspace without git yields nothing - the
 * harness never guesses which files belong to the session.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectChangedJsTsFiles,
	isIgnoredPath,
	isJsTsFile,
	parseGitStatus,
} from "../src/changed-files.js";

let root = "";

function git(...args: string[]): void {
	execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "tooling-changed-"));
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("the changed file detection", () => {
	it("finds the JavaScript and TypeScript files of the worktree", () => {
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "app.ts"), "export const a = 1;\n");
		writeFileSync(join(root, "src", "app.tsx"), "export const B = 1;\n");
		writeFileSync(join(root, "src", "notes.md"), "# notes\n");
		writeFileSync(join(root, "src", "styles.css"), "body {}\n");

		const result = detectChangedJsTsFiles(root);

		expect(result.detected).toBe(true);
		expect(result.files).toEqual(["src/app.ts", "src/app.tsx"]);
	});

	it("finds the files that were changed after the commit", () => {
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
		git("add", ".");
		git("commit", "-q", "-m", "first");
		writeFileSync(join(root, "a.ts"), "export const a = 2;\n");

		const result = detectChangedJsTsFiles(root);

		expect(result.files).toEqual(["a.ts"]);
	});

	it("finds a file that was renamed", () => {
		writeFileSync(join(root, "old.ts"), "export const a = 1;\n");
		git("add", ".");
		git("commit", "-q", "-m", "first");
		git("mv", "old.ts", "new.ts");

		const result = detectChangedJsTsFiles(root);

		expect(result.files).toEqual(["new.ts"]);
	});

	it("ignores the files of a build directory", () => {
		mkdirSync(join(root, "dist"), { recursive: true });
		writeFileSync(join(root, "dist", "bundle.js"), "// built\n");

		const result = detectChangedJsTsFiles(root);

		expect(result.files).toEqual([]);
	});

	it("yields nothing in a workspace that is not a repository", () => {
		const plain = mkdtempSync(join(tmpdir(), "tooling-plain-"));
		try {
			writeFileSync(join(plain, "app.ts"), "export const a = 1;\n");

			const result = detectChangedJsTsFiles(plain);

			expect(result.detected).toBe(false);
			expect(result.files).toEqual([]);
		} finally {
			rmSync(plain, { recursive: true, force: true });
		}
	});
});

describe("the git status parser", () => {
	it("reads the path of every record", () => {
		const output = " M src/app.ts\0?? src/new.ts\0";
		expect(parseGitStatus(output)).toEqual(["src/app.ts", "src/new.ts"]);
	});

	it("skips the original path of a rename", () => {
		const output = "R  src/new.ts\0src/old.ts\0";
		expect(parseGitStatus(output)).toEqual(["src/new.ts"]);
	});
});

describe("the file filters", () => {
	it("knows the JavaScript and TypeScript extensions", () => {
		expect(isJsTsFile("src/app.ts")).toBe(true);
		expect(isJsTsFile("src/app.tsx")).toBe(true);
		expect(isJsTsFile("src/app.mjs")).toBe(true);
		expect(isJsTsFile("src/app.json")).toBe(false);
		expect(isJsTsFile("README.md")).toBe(false);
	});

	it("knows the directories that hold no source", () => {
		expect(isIgnoredPath("node_modules/pkg/index.js")).toBe(true);
		expect(isIgnoredPath("dist/bundle.js")).toBe(true);
		expect(isIgnoredPath("src/app.ts")).toBe(false);
	});
});
