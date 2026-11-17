/**
 * The pairings of the workspaces.
 *
 * A pairing remembers which instance of a workspace the user chose before.
 * It is only a hint for the router: the router still checks that the paired
 * instance is alive and that it runs in the same workspace.
 *
 * The tests use a temporary directory: no real store, no provider.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PairingStore } from "../src/index.js";

/** A temporary directory for a fixture. */
function temporary(): string {
	return mkdtempSync(join(tmpdir(), "plan-handoff-pairing-"));
}

describe("the pairings of the workspaces", () => {
	it("keeps no pairing at first", () => {
		const store = new PairingStore(join(temporary(), "pairings.json"));
		assert.equal(store.read("/tmp/nowhere"), undefined);
	});

	it("remembers the pairing of a workspace", () => {
		const store = new PairingStore(join(temporary(), "pairings.json"));
		store.write("/tmp/project-a", {
			agentId: "agent-a",
			sessionId: "session-a",
			pairedAt: 1_000,
		});

		const pairing = store.read("/tmp/project-a");
		assert.ok(pairing);
		assert.equal(pairing.agentId, "agent-a");
		assert.equal(pairing.sessionId, "session-a");
		assert.equal(pairing.pairedAt, 1_000);
	});

	it("survives a restart of the runtime", () => {
		const file = join(temporary(), "pairings.json");
		new PairingStore(file).write("/tmp/project-a", {
			agentId: "agent-a",
			pairedAt: 1_000,
		});

		const pairing = new PairingStore(file).read("/tmp/project-a");
		assert.ok(pairing);
		assert.equal(pairing.agentId, "agent-a");
	});

	it("finds the pairing through a symlink of the workspace", () => {
		const base = temporary();
		const real = join(base, "real");
		const link = join(base, "link");
		// The directory has to exist: a path that cannot be resolved is
		// compared in its absolute form, and a dangling link is not a
		// spelling of the same workspace.
		mkdirSync(real, { recursive: true });
		symlinkSync(real, link);

		new PairingStore(join(base, "pairings.json")).write(real, {
			agentId: "agent-a",
			pairedAt: 1_000,
		});

		const store = new PairingStore(join(base, "pairings.json"));
		assert.equal(store.read(link)?.agentId, "agent-a");
	});

	it("keeps the pairings of two worktrees apart", () => {
		const store = new PairingStore(join(temporary(), "pairings.json"));
		store.write("/tmp/worktree-a", { agentId: "agent-a", pairedAt: 1_000 });
		store.write("/tmp/worktree-b", { agentId: "agent-b", pairedAt: 1_000 });

		assert.equal(store.read("/tmp/worktree-a")?.agentId, "agent-a");
		assert.equal(store.read("/tmp/worktree-b")?.agentId, "agent-b");
	});

	it("forgets a pairing on request", () => {
		const store = new PairingStore(join(temporary(), "pairings.json"));
		store.write("/tmp/project-a", { agentId: "agent-a", pairedAt: 1_000 });
		store.forget("/tmp/project-a");

		assert.equal(store.read("/tmp/project-a"), undefined);
	});

	it("ignores a file that is not a store", () => {
		const file = join(temporary(), "pairings.json");
		new PairingStore(file).write("/tmp/project-a", {
			agentId: "agent-a",
			pairedAt: 1_000,
		});

		// A file that was cut short by a crash must not throw and must not
		// be read as a pairing.
		const broken = join(temporary(), "broken.json");
		const store = new PairingStore(broken);
		assert.deepEqual(store.readAll(), {});
	});
});
