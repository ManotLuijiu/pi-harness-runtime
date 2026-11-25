/**
 * The command that records a delegation.
 *
 * A delegation says: if I do not answer within the window, continue with
 * this operation. The command is the way the user says it, so the command
 * has to be exact:
 *
 * - A kind that the vocabulary does not name is refused.
 * - The delegation belongs to one workspace, and another one never sees
 *   it.
 * - A removal that names nothing says so instead of pretending.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DelegationStore } from "../harness/delegation-store.ts";
import {
	applyDelegationCommand,
	delegationVocabulary,
	parseDelegationCommand,
} from "../harness/delegation-command.ts";

const WORKSPACE = "/home/frappe/project";
const OTHER = "/home/frappe/other";

function temporary() {
	return mkdtempSync(join(tmpdir(), "delegation-command-"));
}

function apply(args, { store, workspace = WORKSPACE, now = 1000 } = {}) {
	const plan = parseDelegationCommand(args);
	return applyDelegationCommand(plan, { store, workspace, now });
}

test("the command without arguments lists the delegations", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("", { store });
		assert.equal(result.failed, false);
		assert.ok(result.message.includes(WORKSPACE));
		assert.ok(result.message.includes("none"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation is recorded with its kinds and its outcome", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("add commit-and-push continue", { store });
		assert.equal(result.failed, false);
		const delegations = store.list(WORKSPACE);
		assert.equal(delegations.length, 1);
		assert.deepEqual(delegations[0].kinds, ["commit-and-push"]);
		assert.equal(delegations[0].defaultOutcome, "continue");
		assert.equal(delegations[0].workspace, WORKSPACE);
		// The message tells the user how to remove it again.
		assert.ok(result.message.includes(delegations[0].id));
		assert.ok(result.message.includes("remove"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the outcome of a delegation is blocked when the user says so", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("add commit block", { store });
		assert.equal(result.failed, false);
		const delegations = store.list(WORKSPACE);
		assert.equal(delegations[0].defaultOutcome, "block");
		assert.ok(result.message.includes("blocked"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the default outcome of a delegation is to continue", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		apply("add commit", { store });
		assert.equal(store.list(WORKSPACE)[0].defaultOutcome, "continue");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a kind that the vocabulary does not name is refused", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("add commit teleport", { store });
		assert.equal(result.failed, true);
		assert.ok(result.message.includes("teleport"));
		// Nothing was recorded: an unknown kind authorizes nothing.
		assert.equal(store.list(WORKSPACE).length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the same kind is recorded once", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("add commit commit push", { store });
		assert.equal(result.failed, false);
		assert.deepEqual(store.list(WORKSPACE)[0].kinds, ["commit", "push"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an add without a kind asks which one", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("add", { store });
		assert.equal(result.failed, true);
		assert.ok(result.message.includes(delegationVocabulary()));
		assert.equal(store.list(WORKSPACE).length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a remove without an id asks which one", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("remove", { store });
		assert.equal(result.failed, true);
		assert.ok(result.message.includes("remove"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation is removed by its id", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		apply("add commit", { store });
		const id = store.list(WORKSPACE)[0].id;
		const result = apply(`remove ${id}`, { store });
		assert.equal(result.failed, false);
		assert.equal(store.list(WORKSPACE).length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a removal of a delegation that does not exist says so", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("remove nothing-here", { store });
		assert.equal(result.failed, true);
		assert.ok(result.message.includes("nothing-here"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation of another workspace is neither listed nor removed", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		apply("add commit", { store, workspace: OTHER });
		// The delegation exists.
		assert.equal(store.list(OTHER).length, 1);
		// The workspace of the user does not see it.
		assert.equal(store.list(WORKSPACE).length, 0);
		const list = apply("list", { store, workspace: WORKSPACE });
		assert.ok(list.message.includes("none"));
		// And the removal of another workspace does not reach it.
		const id = store.list(OTHER)[0].id;
		const removal = apply(`remove ${id}`, { store, workspace: WORKSPACE });
		assert.equal(removal.failed, true);
		assert.equal(store.list(OTHER).length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the list names every delegation of the workspace", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		apply("add commit", { store, now: 1000 });
		apply("add push block", { store, now: 2000 });
		const list = apply("list", { store });
		assert.ok(list.message.includes("commit"));
		assert.ok(list.message.includes("push"));
		assert.ok(list.message.includes("stay blocked"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the list says that a delegation stays in force until it is removed", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		apply("add commit", { store, now: 1000 });
		const list = apply("list", { store });
		// The user has to know that an older delegation does not end by
		// itself: only the command that removes it ends it.
		assert.ok(
			list.message.includes("stays in force until it is removed"),
			list.message,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the help names the syntax and the vocabulary", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("help", { store });
		assert.equal(result.failed, false);
		assert.ok(result.message.includes("/harness-delegate add"));
		assert.ok(result.message.includes("/harness-delegate remove"));
		assert.ok(result.message.includes(delegationVocabulary()));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an unknown command falls back to the help", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		const result = apply("teleport", { store });
		assert.equal(result.failed, false);
		assert.ok(result.message.includes("Unknown command"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a removal never ends the delegation of another workspace that shares its directory", () => {
	const dir = temporary();
	try {
		const store = new DelegationStore(dir);
		// Two paths that share one directory of the store: the safe name
		// of a workspace is not a unique one.
		const owner = "/project/a_b";
		const other = "/project/a/b";
		store.record({
			id: "d-shared",
			workspace: owner,
			kinds: ["commit"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});

		// The other workspace may not end it.
		assert.equal(store.remove("d-shared", other), false);
		assert.equal(store.list(owner).length, 1);

		// The workspace that owns it may.
		assert.equal(store.remove("d-shared", owner), true);
		assert.equal(store.list(owner).length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
