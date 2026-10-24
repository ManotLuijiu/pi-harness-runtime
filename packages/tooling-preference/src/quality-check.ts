/**
 * The post-change quality check of a JavaScript/TypeScript workspace.
 *
 * The check honors the saved preference: "prefer_biome" runs Biome on the
 * changed files, "use_project_tools" runs the project's own lint script.
 * The check never writes: it reports what it found and the agent fixes it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolingContext } from "./detect.js";
import type { ToolingPreference } from "./proposal.js";

/** The tool that checks the changed files. */
export type QualityCheckTool = "biome" | "project" | "none";

export interface QualityCheckPlan {
	/** The tool that would run. */
	tool: QualityCheckTool;
	/** The binary to run - never a shell string. */
	command: string | null;
	/** The arguments of the command. */
	args: string[];
	/** The files the check looks at. */
	files: string[];
	/** Why this plan - a human wording. */
	reason: string;
}

export interface QualityCheckResult {
	/** Did the check run? */
	ran: boolean;
	/** Did the check pass? Meaningless when the check did not run. */
	passed: boolean;
	/** The tool that ran. */
	tool: QualityCheckTool;
	/** How many files the check looked at. */
	fileCount: number;
	/** The exit code of the check. */
	exitCode: number | null;
	/** Did the check hit the timeout? */
	timedOut: boolean;
	/** The output of the check, truncated. */
	output: string;
	/** Why the result is what it is - a human wording. */
	reason: string;
}

/** A command to run: the binary and its arguments, never a shell string. */
interface CommandSpec {
	command: string;
	args: string[];
}

/** How the tool is started with the package manager of the workspace. */
function packageRunner(packageManager: string | null, binary: string): CommandSpec {
	switch (packageManager) {
		case "bun":
			return { command: "bunx", args: [binary] };
		case "pnpm":
			return { command: "pnpm", args: ["exec", binary] };
		case "yarn":
			return { command: "yarn", args: [binary] };
		case "npm":
			return { command: "npx", args: ["--no-install", binary] };
		default:
			return { command: binary, args: [] };
	}
}

/** How a package script is started with the package manager of the workspace. */
function scriptRunner(packageManager: string | null, script: string): CommandSpec {
	switch (packageManager) {
		case "bun":
			return { command: "bun", args: ["run", script] };
		case "pnpm":
			return { command: "pnpm", args: ["run", script] };
		case "yarn":
			return { command: "yarn", args: [script] };
		default:
			return { command: "npm", args: ["run", script] };
	}
}

/** The scripts of the workspace, if it has a package.json. */
export function readWorkspaceScripts(root: string): Record<string, string> {
	try {
		const path = join(root, "package.json");
		if (!existsSync(path)) return {};
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			scripts?: Record<string, string>;
		};
		const scripts = parsed?.scripts;
		if (!scripts || typeof scripts !== "object") return {};
		return scripts;
	} catch {
		return {};
	}
}

/**
 * Choose the check that runs after a change.
 *
 * The preference decides the tool: Biome when the user asked for it, the
 * project's own script otherwise. A workspace without a saved decision is
 * never checked - the user has not chosen a tool yet.
 */
export function selectQualityCheck(options: {
	context: ToolingContext;
	preference: ToolingPreference | undefined;
	files: string[];
	scripts?: Record<string, string>;
}): QualityCheckPlan {
	const { context, preference, files } = options;
	const scripts = options.scripts ?? readWorkspaceScripts(context.root);

	const none = (reason: string): QualityCheckPlan => ({
		tool: "none",
		command: null,
		args: [],
		files: [],
		reason,
	});

	if (files.length === 0) {
		return none("no JavaScript/TypeScript file changed");
	}
	if (!preference) {
		return none("the user has not chosen a tool yet");
	}

	const projectScript = (): { script: string; spec: CommandSpec } | null => {
		for (const name of ["lint", "typecheck"]) {
			if (typeof scripts[name] === "string") {
				return { script: name, spec: scriptRunner(context.packageManager, name) };
			}
		}
		return null;
	};

	if (preference === "prefer_biome") {
		if (!context.usesBiome) {
			// The user asked for Biome, but the workspace does not have it
			// (yet). The project's own tool is the honest fallback.
			const fallback = projectScript();
			if (!fallback) {
				return none("Biome is not installed and the project has no lint script");
			}
			return {
				tool: "project",
				command: fallback.spec.command,
				args: fallback.spec.args,
				files,
				reason: `Biome is not installed yet - the project script "${fallback.script}" runs instead`,
			};
		}
		const runner = packageRunner(context.packageManager, "biome");
		return {
			tool: "biome",
			command: runner.command,
			args: [...runner.args, "check", ...files],
			files,
			reason: "the preference asks for Biome",
		};
	}

	const script = projectScript();
	if (!script) {
		return none("the project has neither a lint nor a typecheck script");
	}
	return {
		tool: "project",
		command: script.spec.command,
		args: script.spec.args,
		files,
		reason: `the project script "${script.script}" runs`,
	};
}

/**
 * Run the check.
 *
 * The command is started without a shell, with a timeout, and it never
 * writes: a check that wants to fix files is not a check.
 */
export function runQualityCheck(
	plan: QualityCheckPlan,
	options: { cwd: string; timeoutMs?: number; maxOutputChars?: number },
): QualityCheckResult {
	const maxOutputChars = options.maxOutputChars ?? 2000;
	const base = {
		tool: plan.tool,
		fileCount: plan.files.length,
	};

	if (!plan.command) {
		return {
			...base,
			ran: false,
			passed: false,
			exitCode: null,
			timedOut: false,
			output: "",
			reason: plan.reason,
		};
	}

	try {
		const result = spawnSync(plan.command, plan.args, {
			cwd: options.cwd,
			encoding: "utf8",
			timeout: options.timeoutMs ?? 60_000,
			maxBuffer: 8 * 1024 * 1024,
			shell: false,
			env: { ...process.env, CI: process.env.CI ?? "1" },
		});
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
		const error = result.error;
		const timedOut = Boolean(error && /ETIMEDOUT/i.test(String(error.message)));
		const exitCode = result.status ?? null;

		if (error && !timedOut) {
			// The binary does not exist: the check never started.
			return {
				...base,
				ran: false,
				passed: false,
				exitCode: null,
				timedOut: false,
				output: output.slice(0, maxOutputChars),
				reason: `the check could not start: ${String(error.message).slice(0, 200)}`,
			};
		}

		let reason = "the check reported problems";
		if (timedOut) {
			reason = "the check hit the timeout";
		} else if (exitCode === 0) {
			reason = "the check passed";
		}
		return {
			...base,
			ran: true,
			passed: !timedOut && exitCode === 0,
			exitCode,
			timedOut,
			output: output.slice(0, maxOutputChars),
			reason,
		};
	} catch (error) {
		return {
			...base,
			ran: false,
			passed: false,
			exitCode: null,
			timedOut: false,
			output: "",
			reason: `the check could not start: ${String(error).slice(0, 200)}`,
		};
	}
}

/**
 * The status line of the check.
 *
 * The line stays plain ASCII: it is read by the pi host and by terminals
 * without a font of their own.
 */
export function formatQualityCheckStatus(result: QualityCheckResult): string {
	if (!result.ran) {
		return `[TOOL] no check: ${result.reason}`;
	}
	const tool = result.tool === "biome" ? "biome" : "project lint";
	if (result.timedOut) {
		return `[TOOL] ${tool}: ${result.fileCount} file(s), timeout`;
	}
	return `[TOOL] ${tool}: ${result.fileCount} file(s), ${result.passed ? "ok" : "failed"}`;
}
