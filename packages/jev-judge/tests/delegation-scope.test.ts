/**
 * Tests for the measured scope of a task.
 *
 * The measurement is the only source of the numbers of a delegation
 * decision, so it has to count real files and admit when it found
 * nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	fingerprintOf,
	groupFiles,
	measureScope,
	moduleOf,
	scopeHintsFromText,
} from "../src/delegation-scope.js";

let repo: string;

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "delegation-scope-"));
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	mkdirSync(join(repo, "packages", "alpha"), { recursive: true });
	mkdirSync(join(repo, "packages", "beta"), { recursive: true });
	writeFileSync(join(repo, "packages", "alpha", "index.ts"), "export const alpha = 1;\n");
	writeFileSync(join(repo, "packages", "alpha", "extra.ts"), "export const extra = 1;\n");
	writeFileSync(join(repo, "packages", "beta", "index.ts"), "export const beta = 1;\n");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git("add", "-A");
	git("commit", "-qm", "base");
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

describe("the scope hints of a request", () => {
	it("names the paths of the request", () => {
		const hints = scopeHintsFromText("please migrate packages/alpha to the new API");
		expect(hints).toContain("packages/alpha");
	});

	it("names the files of the request", () => {
		const hints = scopeHintsFromText("fix index.ts and the README.md");
		expect(hints).toContain("index.ts");
		expect(hints).toContain("README.md");
	});

	it("has no hint for a request without a path", () => {
		expect(scopeHintsFromText("please refactor everything")).toEqual([]);
	});
});

describe("the measurement of a scope", () => {
	it("counts the files that the request names", () => {
		const measurement = measureScope({
			workspacePath: repo,
			hints: ["packages/alpha"],
		});
		expect(measurement.files).toEqual([
			"packages/alpha/extra.ts",
			"packages/alpha/index.ts",
		]);
		expect(measurement.source).toBe("request");
		expect(measurement.matchedHints).toEqual(["packages/alpha"]);
	});

	it("groups the files per package", () => {
		const measurement = measureScope({
			workspacePath: repo,
			hints: ["packages/"],
		});
		expect(measurement.groups.map((group) => group.id)).toEqual([
			"packages/alpha",
			"packages/beta",
		]);
		expect(measurement.groups[0].files).toHaveLength(2);
	});

	it("measures nothing when the request names nothing", () => {
		const measurement = measureScope({
			workspacePath: repo,
			hints: ["does-not-exist"],
		});
		expect(measurement.files).toEqual([]);
		expect(measurement.groups).toEqual([]);
		expect(measurement.source).toBe("none");
	});

	it("falls back to the files the session changed", () => {
		writeFileSync(join(repo, "packages", "beta", "index.ts"), "export const beta = 2;\n");
		const measurement = measureScope({ workspacePath: repo, hints: [] });
		expect(measurement.files).toEqual(["packages/beta/index.ts"]);
		expect(measurement.source).toBe("working-tree");
	});

	it("counts the workspace files", () => {
		const measurement = measureScope({ workspacePath: repo, hints: [] });
		expect(measurement.workspaceFiles).toBe(4);
	});

	it("gives the same fingerprint for the same files", () => {
		const first = measureScope({ workspacePath: repo, hints: ["packages/alpha"] });
		const second = measureScope({ workspacePath: repo, hints: ["packages/alpha"] });
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.fingerprint).not.toBe(
			measureScope({ workspacePath: repo, hints: ["packages/beta"] }).fingerprint,
		);
	});

	it("has no fingerprint for an empty scope", () => {
		expect(fingerprintOf([])).toBe(fingerprintOf([]));
		expect(fingerprintOf([])).not.toBe(fingerprintOf(["a.ts"]));
	});
});

describe("the module of a file", () => {
	it("is the package of a package file", () => {
		expect(moduleOf("packages/alpha/index.ts")).toBe("packages/alpha");
	});

	it("is the top directory of everything else", () => {
		expect(moduleOf("harness/startup-report.ts")).toBe("harness");
		expect(moduleOf("README.md")).toBe("README.md");
	});

	it("groups the files that share a module", () => {
		const groups = groupFiles([
			"packages/alpha/index.ts",
			"packages/alpha/extra.ts",
			"packages/beta/index.ts",
		]);
		expect(groups).toHaveLength(2);
		expect(groups[0].id).toBe("packages/alpha");
	});
});
