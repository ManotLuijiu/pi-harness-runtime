import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	describeServerState,
	describeWorkspaceMode,
	formatEnvForAgentResult,
	formatEnvStatusLine,
} from "../src/workspace-env-format.ts";
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
		expect(describeServerState(false, true)).toBe("not running (script available)");
		expect(describeServerState(true, true)).toBe("running");
		expect(describeServerState(false, false)).toBe("no script");
	});
});

describe("formatEnvStatusLine", () => {
	test("does not show a bare UNKNOWN next to an available dev script", () => {
		const line = formatEnvStatusLine(makeEnv({ hasDevScript: true, hasBuildScript: true }));

		expect(line).toContain("Workspace: UNKNOWN (no explicit NODE_ENV)");
		expect(line).not.toContain("Workspace: UNKNOWN |");
		expect(line).toContain("dev server: not running (script available)");
		expect(line).toContain("build: not running (script available)");
		expect(line).toContain("RAM: 7.7/15");
	});

	test("a running dev server is reported as running", () => {
		const line = formatEnvStatusLine(makeEnv({ mode: "development", hasDevScript: true, devServerRunning: true }));

		expect(line).toContain("Workspace: DEVELOPMENT");
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
