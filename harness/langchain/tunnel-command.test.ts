/**
 * The tunnel command of the daemon.
 *
 * "auto" is a request to find the tunnel script. The literal word must
 * never reach bash, and a project without a tunnel script must get no
 * tunnel monitor rather than a failing one.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	TUNNEL_SCRIPT_NAME,
	resolveTunnelCommand,
} from "./tunnel-command.js";

/** A scratch directory with a project that has a tunnel script. */
function projectWithTunnel(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-harness-tunnel-"));
	mkdirSync(join(dir, "scripts"), { recursive: true });
	writeFileSync(join(dir, "scripts", TUNNEL_SCRIPT_NAME), "#!/bin/sh\nexit 0\n");
	return dir;
}

/** A scratch directory without a tunnel script. */
function projectWithoutTunnel(): string {
	return mkdtempSync(join(tmpdir(), "pi-harness-tunnel-empty-"));
}

describe("resolveTunnelCommand", () => {
	it("returns an explicit command unchanged", () => {
		const command = "bash scripts/my-tunnel.sh";
		assert.equal(resolveTunnelCommand(command), command);
	});

	it("finds the tunnel script of the project", () => {
		const dir = projectWithTunnel();
		try {
			assert.equal(
				resolveTunnelCommand("auto", dir),
				join(dir, "scripts", TUNNEL_SCRIPT_NAME),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns nothing when neither the project nor the package has a tunnel script", () => {
		const dir = projectWithoutTunnel();
		try {
			assert.equal(resolveTunnelCommand("auto", dir), undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("never resolves to the literal word", () => {
		const dir = projectWithoutTunnel();
		try {
			const resolved = resolveTunnelCommand("auto", dir);
			assert.notEqual(resolved, "auto");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
