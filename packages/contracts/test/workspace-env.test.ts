import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	canShowModeValue,
	collectDotenvVars,
	collectProcessEnvVars,
	describeCwdCommand,
	describeOs,
	describeServerState,
	describeWorkspaceMode,
	detectModeHint,
	filterOwnPids,
	formatEnvForAgentResult,
	formatEnvStatusLine,
	formatWorkspacePath,
	isLauncherCommand,
	MASKED_MODE_VALUE,
	modeFromValue,
	orderDotenvFileNames,
	parseDotenvVars,
	resolveWorkspaceMode,
} from "../src/workspace-env-format.ts";
import {
	DOTENV_MAX_BYTES,
	isTemplateDotenvName,
	readDotenvFiles,
} from "../src/workspace-dotenv.ts";
import type { EnvEvidence, WorkspaceEnvResult } from "../src/workspace-env-format.ts";

function makeEnv(overrides: Partial<WorkspaceEnvResult> = {}): WorkspaceEnvResult {
	return {
		workspacePath: "/home/user/pi-harness-runtime",
		mode: "unknown",
		evidence: [],
		hasDevScript: false,
		hasBuildScript: false,
		packageManager: "bun",
		devServerRunning: false,
		buildServerRunning: false,
		ramTotalGb: 15,
		ramAvailableGb: 7.7,
		ramEffectiveLimitGb: null,
		lowRamWarning: true,
		buildAllowed: false,
		detectedAt: 0,
		...overrides,
	};
}

describe("workspace mode wording", () => {
	test("an unknown mode carries its reason", () => {
		expect(describeWorkspaceMode(makeEnv())).toBe(
			"UNKNOWN (no NODE_ENV or environment variable found)",
		);
	});

	test("a known mode names the variable it came from", () => {
		const evidence: EnvEvidence[] = [
			{
				source: ".env file",
				key: "AMOS_ENV",
				value: "development",
				timestamp: 0,
				file: ".env",
			},
		];

		expect(describeWorkspaceMode(makeEnv({ mode: "development", evidence }))).toBe(
			"DEVELOPMENT (from AMOS_ENV in .env)",
		);
	});

	test("an empty *_ENV variable names itself", () => {
		const evidence: EnvEvidence[] = [
			{ source: ".env file", key: "AMOS_ENV", value: "", timestamp: 0, file: ".env" },
		];

		expect(describeWorkspaceMode(makeEnv({ evidence }))).toBe(
			"UNKNOWN (AMOS_ENV is empty in .env)",
		);
	});

	test("an unrecognized NODE_ENV names the value that could not be read", () => {
		const evidence: EnvEvidence[] = [
			{ source: "process.env", key: "NODE_ENV", value: "staging", timestamp: 0 },
		];

		expect(describeWorkspaceMode(makeEnv({ evidence }))).toBe(
			"UNKNOWN (NODE_ENV=staging is not a known mode)",
		);
	});

	test("a known mode is reported plainly", () => {
		expect(describeWorkspaceMode(makeEnv({ mode: "development" }))).toBe("DEVELOPMENT");
		expect(describeWorkspaceMode(makeEnv({ mode: "production" }))).toBe("PRODUCTION");
		expect(describeWorkspaceMode(makeEnv({ mode: "test" }))).toBe("TEST");
	});

	test("a dev script is a capability, not a state", () => {
		expect(describeServerState("running")).toBe("running");
		expect(describeServerState("not-detected")).toBe("not detected");
		expect(describeServerState("not-checked")).toBe("not checked");
	});
});

describe("the operating system", () => {
	test("the OS is named in a readable form", () => {
		expect(describeOs("linux")).toBe("Linux");
		expect(describeOs("darwin")).toBe("macOS");
		expect(describeOs("win32")).toBe("Windows");
		expect(describeOs("aix")).toBe("aix");
	});

	test("the command that prints the working directory depends on the OS", () => {
		expect(describeCwdCommand("linux")).toBe("pwd");
		expect(describeCwdCommand("darwin")).toBe("pwd");
		expect(describeCwdCommand("win32")).toContain("echo %cd%");
		expect(describeCwdCommand("win32")).toContain("PowerShell");
	});

	test("the home directory is shortened on a path boundary only", () => {
		expect(formatWorkspacePath("/home/user/app", "/home/user")).toBe("~/app");
		expect(formatWorkspacePath("/home/user", "/home/user")).toBe("~");
		expect(formatWorkspacePath("/home/userX/app", "/home/user")).toBe("/home/userX/app");
		expect(formatWorkspacePath("/home/user/app/", "/home/user")).toBe("~/app");
		expect(formatWorkspacePath("/app", "/")).toBe("/app");
	});
});

describe("the process check", () => {
	test("our own processes are not counted as a running server", () => {
		// The shell that runs pgrep carries the pattern in its own command
		// line, so it always matches.
		expect(filterOwnPids(["4242", "4243"], ["4242"])).toEqual(["4243"]);
		expect(filterOwnPids(["", "  "], [])).toEqual([]);
		expect(filterOwnPids(["4242"], [])).toEqual(["4242"]);
	});
});

describe("the server detection", () => {
	test("a launcher is told apart from a server", () => {
		// "npm run dev" only STARTS a server - the server is its child.
		expect(isLauncherCommand("bun run dev")).toBe(true);
		expect(isLauncherCommand("npm run start")).toBe(true);
		expect(isLauncherCommand("yarn dev")).toBe(true);
		// A real server is not a launcher.
		expect(isLauncherCommand("node /srv/app/vite/bin/vite.js")).toBe(false);
		expect(isLauncherCommand("next dev")).toBe(false);
	});
});

describe("the mode detection of a workspace", () => {
	test("the mode is read from a dotenv file of the workspace", () => {
		const vars = collectDotenvVars([{ name: ".env", content: "AMOS_ENV=development\n" }]);
		const resolved = resolveWorkspaceMode([], vars);

		expect(resolved.mode).toBe("development");
		expect(resolved.hint?.key).toBe("AMOS_ENV");
		expect(resolved.hint?.file).toBe(".env");
		expect(resolved.source).toBe(".env file");
	});

	test("a .env.<name> file is read too", () => {
		// The real reading of the files: a variant file of the workspace
		// must be found on disk, not only in a hand made list.
		const dir = mkdtempSync(join(tmpdir(), "wstest-"));
		try {
			writeFileSync(join(dir, ".env.production"), "NODE_ENV=production\n");
			const vars = collectDotenvVars(readDotenvFiles(dir));

			expect(resolveWorkspaceMode([], vars).mode).toBe("production");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the base .env wins over a variant", () => {
		const vars = collectDotenvVars([
			{ name: ".env.production", content: "NODE_ENV=production\n" },
			{ name: ".env", content: "NODE_ENV=development\n" },
		]);

		expect(vars.find((v) => v.key === "NODE_ENV")?.value).toBe("development");
		expect(resolveWorkspaceMode([], vars).mode).toBe("development");
	});

	test("a workspace without a variable keeps the mode unknown", () => {
		const vars = collectDotenvVars([
			{ name: ".env", content: "DATABASE_URL=postgres://localhost\n" },
		]);
		const resolved = resolveWorkspaceMode([], vars);

		expect(resolved.mode).toBe("unknown");
		expect(resolved.hint).toBeNull();
	});

	test("the process env wins over the dotenv files", () => {
		const vars = collectDotenvVars([{ name: ".env", content: "NODE_ENV=production\n" }]);
		const resolved = resolveWorkspaceMode(
			collectProcessEnvVars({ NODE_ENV: "development" }),
			vars,
		);

		expect(resolved.mode).toBe("development");
		expect(resolved.source).toBe("process.env");
	});

	test("an explicit process NODE_ENV decides even when it names no known mode", () => {
		const vars = collectDotenvVars([{ name: ".env", content: "AMOS_ENV=production\n" }]);
		const resolved = resolveWorkspaceMode(collectProcessEnvVars({ NODE_ENV: "staging" }), vars);

		// The explicit "staging" is not overwritten by a file: the mode stays
		// unknown and the label names the value.
		expect(resolved.mode).toBe("unknown");
		expect(resolved.source).toBe("process.env");
		expect(resolved.hint?.value).toBe("staging");
	});

	test("an unrelated environment variable of the process env does not outrank the workspace", () => {
		const vars = collectDotenvVars([{ name: ".env", content: "NODE_ENV=production\n" }]);
		const resolved = resolveWorkspaceMode(
			collectProcessEnvVars({ FOO_ENV: "development" }),
			vars,
		);

		expect(resolved.mode).toBe("production");
		expect(resolved.source).toBe(".env file");
	});

	test("an environment variable of the process env is the last resort", () => {
		const resolved = resolveWorkspaceMode(
			collectProcessEnvVars({ AMOS_ENV: "production" }),
			[],
		);

		expect(resolved.mode).toBe("production");
		expect(resolved.source).toBe("process.env");
	});

	test("an unusable environment variable does not shadow a usable one", () => {
		// The scenario of the user: an early "APP_MODE=" in the same .env
		// must not hide the "AMOS_ENV=development" of line 46.
		const vars = collectDotenvVars([
			{ name: ".env", content: "APP_MODE=staging\nAPP_ENV=\nAMOS_ENV=development\n" },
		]);
		const resolved = resolveWorkspaceMode([], vars);

		expect(resolved.mode).toBe("development");
		expect(resolved.hint?.key).toBe("AMOS_ENV");
		expect(resolved.source).toBe(".env file");
	});

	test("the dotenv file names are ordered", () => {
		expect(
			orderDotenvFileNames([".env.production", ".env", ".env.local", ".env.zzz", "other"]),
		).toEqual([".env", ".env.local", ".env.production", ".env.zzz"]);
	});
});

describe("the mode detection helpers", () => {
	test("a dotenv value is read with its quotes and trailing comment removed", () => {
		const vars = parseDotenvVars(
			[
				"# a comment",
				"",
				"NODE_ENV=production",
				'APP_ENV="development"',
				"export AMOS_ENV=staging",
				"RAILS_ENV: test",
				"BARE",
				"QUOTED_WITH_HASH=abc # trailing",
			].join("\n"),
		);

		expect(vars).toEqual([
			{ key: "NODE_ENV", value: "production" },
			{ key: "APP_ENV", value: "development" },
			{ key: "AMOS_ENV", value: "staging" },
			{ key: "RAILS_ENV", value: "test" },
			{ key: "QUOTED_WITH_HASH", value: "abc" },
		]);
	});

	test("a known mode is read from a value", () => {
		expect(modeFromValue("development")).toBe("development");
		expect(modeFromValue("DEV")).toBe("development");
		expect(modeFromValue(" prod ")).toBe("production");
		expect(modeFromValue("testing")).toBe("test");
		expect(modeFromValue("staging")).toBeNull();
		expect(modeFromValue("")).toBeNull();
	});

	test("NODE_ENV wins over another *_ENV key", () => {
		const hint = detectModeHint([
			{ key: "AMOS_ENV", value: "production" },
			{ key: "NODE_ENV", value: "development" },
		]);

		expect(hint?.key).toBe("NODE_ENV");
	});

	test("another *_ENV key is used when there is no NODE_ENV", () => {
		const hint = detectModeHint([
			{ key: "DATABASE_URL", value: "postgres://localhost" },
			{ key: "AMOS_ENV", value: "production" },
		]);

		expect(hint?.key).toBe("AMOS_ENV");
	});

	test("a value that names a mode is only used in the dotenv files", () => {
		// The process env never decides by a value: an unrelated variable
		// that holds "production" says nothing about the environment.
		const resolved = resolveWorkspaceMode(
			collectProcessEnvVars({ BRANCH: "production" }),
			[],
		);

		expect(resolved.mode).toBe("unknown");
		expect(resolved.hint).toBeNull();
	});

	test("the workspace file wins over the process env", () => {
		// The workspace says "APP_MODE=staging": that is explicit and it
		// must not be replaced by an unrelated variable of the process env.
		const resolved = resolveWorkspaceMode(
			collectProcessEnvVars({ AMOS_ENV: "development" }),
			collectDotenvVars([{ name: ".env", content: "APP_MODE=staging\n" }]),
		);

		expect(resolved.mode).toBe("unknown");
		expect(resolved.hint?.key).toBe("APP_MODE");
		expect(resolved.source).toBe(".env file");
	});

	test("a usable environment shaped key wins over an unusable one", () => {
		const vars = [
			{ key: "APP_MODE", value: "staging" },
			{ key: "AMOS_ENV", value: "development" },
		];

		// The value match is opt-in: a caller has to ask for it.
		expect(detectModeHint(vars, { allowValueMatch: true })?.key).toBe("AMOS_ENV");
		expect(detectModeHint(vars)?.key).toBe("APP_MODE");
	});

	test("only an environment shaped key may decide the mode by its value", () => {
		// BRANCH=production is a branch name, not the environment.
		expect(detectModeHint([{ key: "BRANCH", value: "production" }], { allowValueMatch: true })).toBeNull();
		expect(detectModeHint([{ key: "DEBUG", value: "dev" }], { allowValueMatch: true })).toBeNull();
		expect(detectModeHint([{ key: "APP_ENV", value: "production" }], { allowValueMatch: true })?.key).toBe("APP_ENV");
	});
});

describe("the masking of the mode value", () => {
	test("a secret like key is never shown", () => {
		expect(canShowModeValue("PASSWORD", "production", ".env file")).toBe(false);
		expect(canShowModeValue("API_KEY", "production", ".env file")).toBe(false);
	});

	test("the NODE_ENV of the process env is shown", () => {
		expect(canShowModeValue("NODE_ENV", "staging", "process.env")).toBe(true);
	});

	test("a dotenv value that names no known mode is not shown", () => {
		expect(canShowModeValue("NODE_ENV", "staging", ".env file")).toBe(false);
		expect(canShowModeValue("AMOS_ENV", "production", ".env file")).toBe(true);
	});

	test("an evidence value that names a mode is never called unknown", () => {
		// A stale cache row (the stored mode and the evidence disagree) must
		// not produce "NODE_ENV=development is not a known mode".
		const env = makeEnv({
			mode: "unknown",
			evidence: [
				{
					source: ".env file",
					key: "NODE_ENV",
					value: "development",
					timestamp: 0,
					file: ".env",
				},
			],
		});

		expect(describeWorkspaceMode(env)).toBe("DEVELOPMENT (from NODE_ENV in .env)");
	});

	test("a masked value is named by its key only", () => {
		const env = makeEnv({
			mode: "unknown",
			evidence: [
				{
					source: ".env file",
					key: "NODE_ENV",
					value: MASKED_MODE_VALUE,
					timestamp: 0,
					file: ".env",
				},
			],
		});

		expect(describeWorkspaceMode(env)).toBe("UNKNOWN (NODE_ENV in .env names no known mode)");
	});
});

describe("reading the dotenv files of a workspace", () => {
	test("a template file is not an environment file", () => {
		expect(isTemplateDotenvName(".env.example")).toBe(true);
		expect(isTemplateDotenvName(".env.sample")).toBe(true);
		expect(isTemplateDotenvName(".env.template")).toBe(true);
		expect(isTemplateDotenvName(".env")).toBe(false);
		expect(isTemplateDotenvName(".env.production")).toBe(false);
	});

	test("a template marker in any segment makes the file a template", () => {
		// ".env.example.local" documents a template: it must never decide
		// the mode.
		expect(isTemplateDotenvName(".env.example.local")).toBe(true);
		expect(isTemplateDotenvName(".env.local.sample")).toBe(true);
		expect(isTemplateDotenvName(".env.tpl")).toBe(true);
		expect(isTemplateDotenvName(".env.local.development")).toBe(false);
	});

	test("a symlink out of the workspace is not read", () => {
		const outside = mkdtempSync(join(tmpdir(), "wstest-outside-"));
		const dir = mkdtempSync(join(tmpdir(), "wstest-"));
		try {
			writeFileSync(join(outside, "secret.env"), "AMOS_ENV=production\n");
			// A ".env" that points outside the workspace is not the
			// configuration of the workspace.
			symlinkSync(join(outside, "secret.env"), join(dir, ".env"));
			expect(readDotenvFiles(dir)).toEqual([]);

			// A link that stays inside the workspace is fine.
			writeFileSync(join(dir, "real.env"), "AMOS_ENV=development\n");
			symlinkSync(join(dir, "real.env"), join(dir, ".env.local"));
			const files = readDotenvFiles(dir);
			expect(files.map((f) => f.name)).toEqual([".env.local"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("the files are read from the workspace, not from the working directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "wstest-"));
		try {
			writeFileSync(join(dir, ".env"), "AMOS_ENV=development\n");
			writeFileSync(join(dir, ".env.example"), "BRANCH=production\n");

			const files = readDotenvFiles(dir);
			expect(files.map((f) => f.name)).toEqual([".env"]);
			expect(files[0].content).toContain("AMOS_ENV=development");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a missing workspace has no environment files", () => {
		expect(readDotenvFiles(join(tmpdir(), "wstest-does-not-exist-12345"))).toEqual([]);
	});

	test("a file of exactly the maximum size is read", () => {
		const dir = mkdtempSync(join(tmpdir(), "wstest-"));
		try {
			// The limit is a limit, not an off by one: "X=" + N + "\n" is
			// exactly DOTENV_MAX_BYTES.
			writeFileSync(join(dir, ".env"), "X=" + "a".repeat(DOTENV_MAX_BYTES - 3) + "\n");
			const files = readDotenvFiles(dir);
			expect(files).toHaveLength(1);
			expect(files[0].content).toContain("X=aaa");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a file that is too big is not read", () => {
		const dir = mkdtempSync(join(tmpdir(), "wstest-"));
		try {
			writeFileSync(join(dir, ".env"), `X=${"a".repeat(DOTENV_MAX_BYTES + 10)}\n`);
			expect(readDotenvFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("formatEnvStatusLine", () => {
	test("does not show a bare UNKNOWN next to an available dev script", () => {
		const line = formatEnvStatusLine(makeEnv({ hasDevScript: true, hasBuildScript: true }));

		expect(line).toContain("mode: UNKNOWN (no NODE_ENV or environment variable found)");
		expect(line).not.toContain("Workspace: UNKNOWN |");
		// Without a stored state the honest answer is "not checked" - the
		// old cache cannot tell a missing server from a platform where no
		// check was possible.
		expect(line).toContain("dev server: not checked");
		expect(line).toContain("build server: not checked");
		expect(line).toContain("dev script: available");
		expect(line).toContain("build script: available");
		expect(line).toContain("RAM: 7.7/15");
	});

	test("a stored server state is reported as it is", () => {
		const line = formatEnvStatusLine(
			makeEnv({ devServerState: "running", buildServerState: "not-detected" }),
		);

		expect(line).toContain("dev server: running");
		expect(line).toContain("build server: not detected");
	});

	test("the legacy server state signature still works", () => {
		expect(describeServerState(true, false)).toBe("running");
		expect(describeServerState(false, true)).toBe("not running (script available)");
		expect(describeServerState(false, false)).toBe("no script");
	});

	test("the line names the workspace path and the operating system", () => {
		const line = formatEnvStatusLine(makeEnv());

		expect(line).toContain(`Workspace: ${formatWorkspacePath("/home/user/pi-harness-runtime")}`);
		expect(line).toContain(`OS: ${describeOs()}`);
	});

	test("an unchecked server is not reported as not running", () => {
		const line = formatEnvStatusLine(
			makeEnv({ devServerState: "not-checked", buildServerState: "not-checked" }),
		);

		expect(line).toContain("dev server: not checked");
		expect(line).not.toContain("dev server: not detected");
		expect(line).not.toContain("not running");
	});

	test("a running dev server is reported as running", () => {
		const line = formatEnvStatusLine(makeEnv({ mode: "development", hasDevScript: true, devServerRunning: true }));

		expect(line).toContain("mode: DEVELOPMENT");
		expect(line).toContain("dev server: running");
	});

	test("a missing RAM reading omits the RAM segment", () => {
		const line = formatEnvStatusLine(makeEnv({ ramTotalGb: null, ramAvailableGb: null }));

		expect(line).not.toContain("RAM:");
	});

	test("a partial RAM reading never renders a null value", () => {
		const available = formatEnvStatusLine(makeEnv({ ramTotalGb: null, ramAvailableGb: 7.7 }));
		const total = formatEnvStatusLine(makeEnv({ ramTotalGb: 15, ramAvailableGb: null }));

		expect(available).toContain("RAM: 7.7GB available");
		expect(available).not.toContain("null");
		expect(total).toContain("RAM: 15GB total");
		expect(total).not.toContain("null");
	});
});

describe("export surface of workspace-env.ts", () => {
	// The module itself needs node:sqlite, which bun 1.3.x does not provide.
	// Assert the re-export surface on the source text instead.
	const source = readFileSync(
		join(import.meta.dir, "..", "src", "workspace-env.ts"),
		"utf8",
	);

	test("keeps re-exporting the formatting helpers", () => {
		for (const name of [
			"describeServerState",
			"describeWorkspaceMode",
			"formatEnvForAgentResult",
		]) {
			// The name must be part of an export statement, not only a word
			// somewhere in the file.
			expect(source).toMatch(new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`, "s"));
		}
	});

	test("keeps exporting the detector functions", () => {
		for (const name of [
			"detectWorkspaceEnv",
			"loadWorkspaceEnv",
			"getWorkspaceEnv",
			"revalidateWorkspaceEnv",
			"formatEnvForAgent",
			"formatEnvStatusLine",
		]) {
			expect(source).toContain(`export function ${name}`);
		}
	});
});

describe("formatEnvForAgentResult", () => {
	test("explains that a dev script does not establish the mode", () => {
		const text = formatEnvForAgentResult(makeEnv({ hasDevScript: true }));

		expect(text).toContain("Mode: UNKNOWN (no NODE_ENV or environment variable found)");
		expect(text).toContain("Dev script: yes");
		expect(text).toContain("Build allowed: no - requires explicit request");
		expect(text).toContain("a dev/build script only means a server CAN be started");
	});

	test("a known mode drops the unknown-mode note", () => {
		const text = formatEnvForAgentResult(makeEnv({ mode: "production", buildAllowed: true }));

		expect(text).toContain("Mode: PRODUCTION");
		expect(text).toContain("Build allowed: yes");
		expect(text).not.toContain("Environment unknown");
	});
});

describe("the template files of a workspace", () => {
	test("a plural template name is a template too", () => {
		expect(isTemplateDotenvName(".env.examples")).toBe(true);
		expect(isTemplateDotenvName(".env.samples")).toBe(true);
		expect(isTemplateDotenvName(".env.templates")).toBe(true);
		expect(isTemplateDotenvName(".env.example")).toBe(true);
		expect(isTemplateDotenvName(".env.local")).toBe(false);
		expect(isTemplateDotenvName(".env.production")).toBe(false);
	});
});
