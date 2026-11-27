/**
 * The tool of the Frappe lifecycle.
 *
 * The tool is the live seam between the agent and the policy: it reads
 * the ownership of the DocType from the bench, decides what may happen
 * and never runs a command of a bench itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createFrappeLifecycleTool } from "../harness/frappe-lifecycle-tool.ts";
import { DelegationStore } from "../harness/delegation-store.ts";
import { ApprovalDecisionStore } from "../harness/approval-decision-store.ts";
import { DelegatedApprovalRuntime } from "../harness/delegated-approval-runtime.ts";
import { createPendingActionRegistry } from "../harness/pending-actions.ts";

/**
 * A bench with two apps.
 *
 * - warehouse_app owns the DocType Item,
 * - ledger_app owns the DocType Journal.
 */
function makeBench() {
	const dir = mkdtempSync(join(tmpdir(), "frappe-lifecycle-tool-"));
	const app = (name, namespace, module, doctype) => {
		const base = join(dir, "apps", name, namespace, module, "doctype", doctype);
		mkdirSync(base, { recursive: true });
		writeFileSync(
			join(dir, "apps", name, namespace, "__init__.py"),
			"",
			"utf8",
		);
		writeFileSync(
			join(base, `${doctype}.json`),
			JSON.stringify({ name: doctype, module }),
			"utf8",
		);
	};
	app("warehouse_app", "warehouse_app", "stock", "item");
	app("ledger_app", "ledger_app", "accounts", "journal");
	writeFileSync(
		join(dir, "apps", "warehouse_app", "hooks.py"),
		[
			"after_install = [\"warehouse_app.setup.install.after_install\"]",
			"after_migrate = [\"warehouse_app.setup.migrate.after_migrate\"]",
		].join("\n"),
		"utf8",
	);
	writeFileSync(join(dir, "apps.txt"), "warehouse_app\nledger_app\n", "utf8");
	const fixtures = join(dir, "apps", "warehouse_app", "fixtures");
	mkdirSync(fixtures, { recursive: true });
	writeFileSync(
		join(fixtures, "custom_field.json"),
		JSON.stringify([{ dt: "Journal", fieldname: "cost_center" }]),
		"utf8",
	);
	// The routine of the hook of the install, and the file of the patches
	// of the namespace: the bench has to show them, otherwise nothing
	// about the routine is inspected.
	const setup = join(dir, "apps", "warehouse_app", "warehouse_app", "setup");
	mkdirSync(setup, { recursive: true });
	writeFileSync(
		join(setup, "install.py"),
		[
			"def after_install():",
			"\tfrappe.get_doc(\"Item\").save()",
			"",
		].join("\n"),
		"utf8",
	);
	writeFileSync(
		join(dir, "apps", "warehouse_app", "warehouse_app", "patches.txt"),
		[
			"warehouse_app.patches.v1_0.set_default_warehouse",
			"",
		].join("\n"),
		"utf8",
	);
	return dir;
}

/** A runtime of the delegated approval with a pinned clock. */
function makeRuntime(dir) {
	let now = 1000;
	const delegations = new DelegationStore(dir);
	const decisions = new ApprovalDecisionStore(dir);
	const delivered = [];
	const runtime = new DelegatedApprovalRuntime({
		now: () => now,
		delegations,
		decisions,
		deliver: async (request) => {
			delivered.push(request);
			return { delivered: true, failures: [] };
		},
		resume: () => {},
	});
	return { runtime, delivered, setNow: (value) => (now = value) };
}

/** The text of an answer. */
function textOf(answer) {
	return answer.content.map((entry) => entry.text).join("\n");
}

test("an operation that the permission covers may run", async () => {
	const bench = makeBench();
	try {
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			standingGrant: {
				source: "standing",
				scope: "the source of the app",
				site: "demo.local",
				app: "warehouse_app",
				effects: ["native-source"],
			},
		});
		const answer = await tool.execute("call-1", {
			doctype: "Item",
			mechanism: "source-json",
			proposal: "add the field warehouse_bin to the DocType Item",
			site: "demo.local",
			app: "warehouse_app",
			idempotent: true,
		});
		assert.equal(answer.details.dispatch, "execute");
		assert.equal(answer.details.effect, "native-source");
		assert.equal(answer.details.ownerApp, "warehouse_app");
		assert.match(textOf(answer), /You may run it/);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("an operation without a permission asks the human", async () => {
	const bench = makeBench();
	try {
		const { runtime, delivered } = makeRuntime(bench);
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			approval: () => runtime,
			sessionId: () => "session-1",
			workspace: () => bench,
		});
		const answer = await tool.execute("call-1", {
			doctype: "Item",
			mechanism: "source-json",
			proposal: "add the field warehouse_bin to the DocType Item",
			site: "demo.local",
			app: "warehouse_app",
			idempotent: true,
		});
		assert.equal(answer.details.dispatch, "approval");
		assert.equal(delivered.length, 1);
		assert.equal(
			delivered[0].deadlineAt,
			undefined,
			"the question of the human has no deadline",
		);
		assert.match(textOf(answer), /Do not run the operation until the answer/);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("the source of a DocType of another app is not changed", async () => {
	const bench = makeBench();
	try {
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			standingGrant: {
				source: "standing",
				scope: "everything",
				site: "demo.local",
				effects: ["native-source", "customization"],
			},
		});
		const answer = await tool.execute("call-1", {
			doctype: "Journal",
			mechanism: "source-json",
			proposal: "add the field cost_center to the DocType Journal",
			site: "demo.local",
			app: "warehouse_app",
			idempotent: true,
		});
		assert.equal(answer.details.dispatch, "blocked");
		assert.match(answer.details.reason, /ledger_app|incomplete/);
		assert.match(textOf(answer), /Do not run the operation/);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("the customization of a DocType of another app uses the Custom Field", async () => {
	const bench = makeBench();
	try {
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			standingGrant: {
				source: "standing",
				scope: "everything",
				site: "demo.local",
				effects: ["customization"],
			},
		});
		const answer = await tool.execute("call-1", {
			doctype: "Journal",
			mechanism: "custom-field",
			proposal: "add the field cost_center to the DocType Journal",
			site: "demo.local",
			app: "warehouse_app",
			idempotent: true,
		});
		assert.equal(answer.details.dispatch, "execute");
		assert.equal(answer.details.effect, "customization");
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("a hook that the app does not register is blocked", async () => {
	const bench = makeBench();
	try {
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			standingGrant: {
				source: "standing",
				scope: "everything",
				site: "demo.local",
				effects: ["customization", "native-source", "data-migration"],
			},
		});
		const answer = await tool.execute("call-1", {
			doctype: "Item",
			mechanism: "hook",
			proposal:
				"bench --site demo.local install-app warehouse_app",
			site: "demo.local",
			app: "warehouse_app",
			function: "warehouse_app.setup.install.after_install",
			idempotent: true,
		});
		assert.equal(answer.details.dispatch, "execute");
		const unknown = await tool.execute("call-2", {
			doctype: "Item",
			mechanism: "hook",
			proposal:
				"bench --site demo.local execute warehouse_app.setup.install.not_registered",
			site: "demo.local",
			app: "warehouse_app",
			function: "warehouse_app.setup.install.not_registered",
			idempotent: true,
		});
		assert.equal(unknown.details.dispatch, "blocked");
		assert.match(unknown.details.reason, /not registered|incomplete/);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("a routine that an operator runs by hand is not authorized", async () => {
	const bench = makeBench();
	try {
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			standingGrant: {
				source: "standing",
				scope: "everything",
				site: "demo.local",
				effects: ["customization", "native-source", "data-migration"],
			},
		});
		const answer = await tool.execute("call-1", {
			doctype: "Item",
			mechanism: "hook",
			proposal:
				"bench --site demo.local execute warehouse_app.setup.install.after_install",
			site: "demo.local",
			app: "warehouse_app",
			function: "warehouse_app.setup.install.after_install",
			idempotent: true,
		});
		// The platform records the install of the app, but a routine that
		// an operator runs by hand is recorded by nothing: the claim of
		// the request is not the inspection of the bench.
		assert.equal(answer.details.dispatch, "blocked");
		assert.match(
			answer.details.unknowns.join(" "),
			/the claim was not inspected/,
		);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("a patch that the app does not register is blocked", async () => {
	const bench = makeBench();
	try {
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			standingGrant: {
				source: "standing",
				scope: "everything",
				site: "demo.local",
				effects: ["customization", "native-source", "data-migration"],
			},
		});
		const registered = await tool.execute("call-1", {
			doctype: "Item",
			mechanism: "patch",
			proposal:
				"bench --site demo.local migrate --patch warehouse_app.patches.v1_0.set_default_warehouse",
			site: "demo.local",
			app: "warehouse_app",
			patch: "warehouse_app.patches.v1_0.set_default_warehouse",
			idempotent: true,
		});
		assert.equal(registered.details.dispatch, "execute");
		assert.equal(registered.details.effect, "data-migration");
		const unknown = await tool.execute("call-2", {
			doctype: "Item",
			mechanism: "patch",
			proposal:
				"bench --site demo.local migrate --patch warehouse_app.patches.v1_0.not_registered",
			site: "demo.local",
			app: "warehouse_app",
			patch: "warehouse_app.patches.v1_0.not_registered",
			idempotent: true,
		});
		assert.equal(unknown.details.dispatch, "blocked");
		assert.match(unknown.details.reason, /not registered|incomplete/);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("a confirmation counts down in the pending actions", async () => {
	const bench = makeBench();
	try {
		const pending = createPendingActionRegistry();
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			pending: () => pending,
			projectRule: "confirm",
			standingGrant: {
				source: "standing",
				scope: "everything",
				site: "demo.local",
				effects: ["native-source"],
			},
		});
		const answer = await tool.execute("call-1", {
			doctype: "Item",
			mechanism: "source-json",
			proposal: "add the field warehouse_bin to the DocType Item",
			site: "demo.local",
			app: "warehouse_app",
			idempotent: true,
		});
		assert.equal(answer.details.dispatch, "countdown");
		assert.equal(pending.list().length, 1);
		assert.equal(pending.list()[0].kind, "resume");
		assert.match(textOf(answer), /waits for the confirmation/);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("a destructive operation asks the human, even with a wide permission", async () => {
	const bench = makeBench();
	try {
		const { runtime, delivered } = makeRuntime(bench);
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			now: () => 1000,
			generation: () => 5,
			approval: () => runtime,
			standingGrant: {
				source: "standing",
				scope: "everything",
				site: "demo.local",
				effects: ["destructive", "native-source", "customization"],
			},
		});
		const answer = await tool.execute("call-1", {
			doctype: "Item",
			mechanism: "destructive",
			proposal: "delete the rows of the DocType Item",
			site: "demo.local",
			app: "warehouse_app",
			function: "warehouse_app.setup.install.after_install",
			idempotent: true,
		});
		assert.equal(answer.details.dispatch, "approval");
		assert.match(answer.details.reason, /destroys data/);
		assert.equal(delivered.length, 1);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});
