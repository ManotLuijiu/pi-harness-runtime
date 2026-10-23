import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	describeCwdCommand,
	describeOs,
	describeServerState,
	describeWorkspaceMode,
	filterOwnPids,
	formatEnvForAgentResult,
	formatEnvStatusLine,
	formatWorkspacePath,
	isLauncherCommand,
} from "../src/workspace-env-format.ts";
import type { EnvEvidence, WorkspaceEnvResult } from "../src/workspace-env-format.ts";

function makeEnv(overrides: Partial<WorkspaceEnvResult> = {}): WorkspaceEnvResult {
	return {
		workspacePath: "/home/frappe/pi-harness-runtime",
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
		expect(describeWorkspaceMode(makeEnv())).toBe("UNKNOWN (no explicit NODE_ENV)");
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
		expect(formatWorkspacePath("/home/frappe/app", "/home/frappe")).toBe("~/app");
		expect(formatWorkspacePath("/home/frappe", "/home/frappe")).toBe("~");
		expect(formatWorkspacePath("/home/frappeX/app", "/home/frappe")).toBe("/home/frappeX/app");
		expect(formatWorkspacePath("/home/frappe/app/", "/home/frappe")).toBe("~/app");
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

describe("formatEnvStatusLine", () => {
	test("does not show a bare UNKNOWN next to an available dev script", () => {
		const line = formatEnvStatusLine(makeEnv({ hasDevScript: true, hasBuildScript: true }));

		expect(line).toContain("mode: UNKNOWN (no explicit NODE_ENV)");
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

		expect(line).toContain(`Workspace: ${formatWorkspacePath("/home/frappe/pi-harness-runtime")}`);
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
			expect(source).toContain(name);
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

		expect(text).toContain("Mode: UNKNOWN (no explicit NODE_ENV)");
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
