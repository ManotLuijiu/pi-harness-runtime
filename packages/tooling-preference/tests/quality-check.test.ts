/**
 * The post-change quality check.
 *
 * The saved preference decides the tool: Biome when the user asked for it,
 * the project's own script otherwise. The check never writes and never runs
 * without a decision of the user.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatQualityCheckStatus,
	runQualityCheck,
	selectQualityCheck,
} from "../src/quality-check.js";
import type { ToolingContext } from "../src/detect.js";

const cleanups: string[] = [];

function workspace(pkg: unknown, files: Record<string, string> = {}): string {
	const root = mkdtempSync(join(tmpdir(), "tooling-check-"));
	cleanups.push(root);
	writeFileSync(join(root, "package.json"), JSON.stringify(pkg), "utf8");
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(root, name), content, "utf8");
	}
	return root;
}

function context(root: string, overrides: Partial<ToolingContext> = {}): ToolingContext {
	return {
		root,
		hasPackageJson: true,
		isJavaScriptTypeScript: true,
		isNextJs: false,
		isReact: false,
		usesBiome: false,
		usesEslint: true,
		usesPrettier: false,
		packageManager: "npm",
		frameworks: [],
		...overrides,
	};
}

afterEach(() => {
	while (cleanups.length > 0) {
		const root = cleanups.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

describe("the check selection", () => {
	it("runs Biome on the changed files when the preference asks for it", () => {
		const root = workspace({ name: "web" });
		const plan = selectQualityCheck({
			context: context(root, { usesBiome: true, packageManager: "bun" }),
			preference: "prefer_biome",
			files: ["src/app.ts"],
		});

		expect(plan.tool).toBe("biome");
		expect(plan.command).toBe("bunx");
		expect(plan.args).toEqual(["biome", "check", "src/app.ts"]);
		expect(plan.files).toEqual(["src/app.ts"]);
	});

	it("never asks Biome to fix the files", () => {
		const root = workspace({ name: "web" });
		const plan = selectQualityCheck({
			context: context(root, { usesBiome: true }),
			preference: "prefer_biome",
			files: ["src/app.ts"],
		});

		expect(plan.args.join(" ")).not.toContain("--write");
		expect(plan.args.join(" ")).not.toContain("--fix");
	});

	it("runs the project script when the preference keeps the project tools", () => {
		const root = workspace({ name: "web", scripts: { lint: "eslint ." } });
		const plan = selectQualityCheck({
			context: context(root),
			preference: "use_project_tools",
			files: ["src/app.ts"],
		});

		expect(plan.tool).toBe("project");
		expect(plan.command).toBe("npm");
		expect(plan.args).toEqual(["run", "lint"]);
	});

	it("falls back to the project script when Biome is not installed yet", () => {
		const root = workspace({ name: "web", scripts: { lint: "eslint ." } });
		const plan = selectQualityCheck({
			context: context(root, { usesBiome: false }),
			preference: "prefer_biome",
			files: ["src/app.ts"],
		});

		expect(plan.tool).toBe("project");
		expect(plan.reason).toContain("Biome is not installed");
	});

	it("checks nothing without a decision of the user", () => {
		const root = workspace({ name: "web", scripts: { lint: "eslint ." } });
		const plan = selectQualityCheck({
			context: context(root),
			preference: undefined,
			files: ["src/app.ts"],
		});

		expect(plan.tool).toBe("none");
		expect(plan.command).toBeNull();
		expect(plan.reason).toContain("not chosen");
	});

	it("checks nothing when no file changed", () => {
		const root = workspace({ name: "web", scripts: { lint: "eslint ." } });
		const plan = selectQualityCheck({
			context: context(root),
			preference: "use_project_tools",
			files: [],
		});

		expect(plan.tool).toBe("none");
		expect(plan.reason).toContain("no JavaScript/TypeScript file changed");
	});

	it("checks nothing when the project has no script to run", () => {
		const root = workspace({ name: "web" });
		const plan = selectQualityCheck({
			context: context(root),
			preference: "use_project_tools",
			files: ["src/app.ts"],
		});

		expect(plan.tool).toBe("none");
		expect(plan.reason).toContain("neither a lint nor a typecheck");
	});

	it("uses the typecheck script when there is no lint script", () => {
		const root = workspace({ name: "web", scripts: { typecheck: "tsc --noEmit" } });
		const plan = selectQualityCheck({
			context: context(root),
			preference: "use_project_tools",
			files: ["src/app.ts"],
		});

		expect(plan.command).toBe("npm");
		expect(plan.args).toEqual(["run", "typecheck"]);
	});
});

describe("the check itself", () => {
	it("reports a passing check", () => {
		const root = workspace({ name: "web" });
		const plan = selectQualityCheck({
			context: context(root),
			preference: "use_project_tools",
			files: ["src/app.ts"],
		});
		const pass = {
			tool: plan.tool,
			command: "node",
			args: ["-e", "process.exit(0)"],
			files: ["src/app.ts"],
			reason: "test",
		};

		const result = runQualityCheck(pass, { cwd: root, timeoutMs: 10_000 });

		expect(result.ran).toBe(true);
		expect(result.passed).toBe(true);
		expect(result.reason).toContain("passed");
	});

	it("reports a failing check", () => {
		const root = workspace({ name: "web" });
		const fail = {
			tool: "project" as const,
			command: "node",
			args: ["-e", "process.stderr.write('problem'); process.exit(2)"],
			files: ["src/app.ts"],
			reason: "test",
		};

		const result = runQualityCheck(fail, { cwd: root, timeoutMs: 10_000 });

		expect(result.ran).toBe(true);
		expect(result.passed).toBe(false);
		expect(result.exitCode).toBe(2);
		expect(result.output).toContain("problem");
	});

	it("reports a check that cannot start", () => {
		const result = runQualityCheck(
			{
				tool: "project",
				command: "definitely-not-a-command",
				args: [],
				files: ["src/app.ts"],
				reason: "test",
			},
			{ cwd: process.cwd(), timeoutMs: 10_000 },
		);

		expect(result.ran).toBe(false);
		expect(result.reason).toContain("could not start");
	});

	it("runs nothing when the plan has no command", () => {
		const result = runQualityCheck(
			{ tool: "none", command: null, args: [], files: [], reason: "nothing to do" },
			{ cwd: process.cwd(), timeoutMs: 10_000 },
		);

		expect(result.ran).toBe(false);
		expect(result.passed).toBe(false);
	});
});

describe("the status line", () => {
	it("names the tool and the outcome", () => {
		const line = formatQualityCheckStatus({
			ran: true,
			passed: true,
			tool: "biome",
			fileCount: 3,
			exitCode: 0,
			timedOut: false,
			output: "",
			reason: "the check passed",
		});

		expect(line).toBe("[TOOL] biome: 3 file(s), ok");
		expect(/[^\x20-\x7e]/.test(line)).toBe(false);
	});

	it("names the reason when no check ran", () => {
		const line = formatQualityCheckStatus({
			ran: false,
			passed: false,
			tool: "none",
			fileCount: 0,
			exitCode: null,
			timedOut: false,
			output: "",
			reason: "no JavaScript/TypeScript file changed",
		});

		expect(line).toContain("no check");
		expect(line).toContain("no JavaScript/TypeScript file changed");
	});

	it("names a timeout", () => {
		const line = formatQualityCheckStatus({
			ran: true,
			passed: false,
			tool: "project",
			fileCount: 2,
			exitCode: null,
			timedOut: true,
			output: "",
			reason: "the check hit the timeout",
		});

		expect(line).toContain("timeout");
	});
});
