/**
 * The wiring of the countdown of a Frappe operation.
 *
 * The countdown is only useful when it runs where the operation is
 * proposed and where the request ends: the tool of the lifecycle arms the
 * countdown when the policy asks for a confirmation, the owner keeps the
 * assessment that the expiry is checked against, and the request that
 * ends forgets its countdowns.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createFrappeLifecycleTool } from "../harness/frappe-lifecycle-tool.ts";
import { FrappeCountdownDispatcher } from "../harness/frappe-countdown.ts";
import { createPendingActionRegistry } from "../harness/pending-actions.ts";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(source, needle, before = 0, after = 1400) {
	const at = source.indexOf(needle);
	if (at === -1) return "";
	return source.slice(Math.max(0, at - before), at + after);
}

/**
 * A bench with one app that owns the DocType Item.
 */
function makeBench() {
	const dir = mkdtempSync(join(tmpdir(), "frappe-countdown-wiring-"));
	const base = join(dir, "apps", "warehouse_app", "warehouse_app", "stock", "doctype", "item");
	mkdirSync(base, { recursive: true });
	writeFileSync(join(dir, "apps", "warehouse_app", "warehouse_app", "__init__.py"), "", "utf8");
	writeFileSync(join(base, "item.json"), JSON.stringify({ name: "Item", module: "stock" }), "utf8");
	writeFileSync(
		join(dir, "apps", "warehouse_app", "hooks.py"),
		'after_install = ["warehouse_app.setup.install.after_install"]\n',
		"utf8",
	);
	writeFileSync(join(dir, "apps.txt"), "warehouse_app\n", "utf8");
	// The routine of the hook of the install: the bench has to show it,
	// otherwise nothing about the routine is inspected.
	const setup = join(dir, "apps", "warehouse_app", "warehouse_app", "setup");
	mkdirSync(setup, { recursive: true });
	writeFileSync(
		join(setup, "install.py"),
		"def after_install():\n\tpass\n",
		"utf8",
	);
	return dir;
}

/** The permission that stands for the operation of the test. */
const grant = {
	source: "standing",
	scope: "the migrations of the site demo.local",
	site: "demo.local",
	effects: ["data-migration"],
};

test("the tool arms the countdown and the owner keeps the assessment", async () => {
	const bench = makeBench();
	const pending = createPendingActionRegistry();
	const messages = [];
	let now = 1000;
	const dispatcher = new FrappeCountdownDispatcher({
		pending,
		now: () => now,
		state: () => ({ requestGeneration: 3, authorization: grant }),
		dispatch: async (message) => {
			messages.push(message);
			return { dispatched: true };
		},
		setTimeout: () => null,
		clearTimeout: () => undefined,
	});
	try {
		const tool = createFrappeLifecycleTool({
			benchPath: bench,
			pending: () => pending,
			countdown: () => dispatcher,
			projectRule: "confirm",
			standingGrant: grant,
			generation: () => 3,
			sessionId: () => "session-1",
			workspace: () => bench,
			now: () => now,
		});

		const result = await tool.execute("call-1", {
			doctype: "Item",
			mechanism: "hook",
			proposal:
				"bench --site demo.local install-app warehouse_app",
			site: "demo.local",
			app: "warehouse_app",
			module: "stock",
			function: "warehouse_app.setup.install.after_install",
			steps: 3,
			idempotent: true,
		});

		// The policy asked for a confirmation: the operation waits.
		assert.equal(result.details.dispatch, "countdown");
		assert.match(result.details.reason, /confirmation expires/);

		// The owner of the countdown knows the proposal that was assessed.
		const known = dispatcher.list();
		assert.equal(known.length, 1);
		assert.equal(known[0].assessment.proposal.includes("bench --site demo.local"), true);
		assert.equal(known[0].assessment.requestGeneration, 3);
		assert.equal(known[0].assessment.authorization.source, "standing");

		// The row of the countdown is the one of the registry.
		const rows = pending.list();
		assert.equal(rows.length, 1);
		assert.equal(rows[0].owner, "frappe-lifecycle");
		assert.equal(rows[0].state, "scheduled");
		assert.equal(rows[0].dueAt, now + 120_000);

		// The expiry of the countdown tells the agent that it may run.
		now = now + 120_000;
		const outcomes = await dispatcher.fire();
		assert.equal(outcomes[0].kind, "authorized");
		assert.equal(messages.length, 1);
		assert.match(messages[0], /You may run the operation now/);
	} finally {
		rmSync(bench, { recursive: true, force: true });
	}
});

test("the session wires the owner of the countdowns", () => {
	const region = around(indexSource, "const frappeCountdown = new FrappeCountdownDispatcher(", 0, 1200);
	assert.ok(region, "the owner of the countdowns exists");
	assert.match(region, /pending: pendingActions/, "the row of the countdown is the one of the registry");
	assert.match(
		region,
		/requestGeneration: requestScopeTracker\.generation/,
		"the state of the expiry names the request that runs now",
	);
	assert.match(
		region,
		/dispatch: \(message\) => dispatchFrappeCountdown\(message\)/,
		"the message of the expiry goes through the guarded path",
	);
});

test("the message of the expiry goes through the guarded path of the session", () => {
	const region = around(indexSource, "async function dispatchFrappeCountdown(", 0, 1200);
	assert.ok(region, "the dispatch of the countdown exists");
	assert.match(region, /todoContinuationController/, "the guarded path is the continuation controller");
	assert.match(region, /dispatchAdvisory\(/, "the dispatch is the advisory of the controller");
	assert.match(
		region,
		/the guarded path is not available/,
		"a session without the guarded path says so instead of sending the message anyway",
	);
});

test("the request that ends forgets its countdowns", () => {
	const region = around(indexSource, "requestIssues.forget(generation);", 0, 600);
	assert.ok(region, "the request forgets its authorized issues");
	assert.match(
		region,
		/frappeCountdown\.forget\(generation\)/,
		"the countdowns of the request are forgotten with it",
	);
});
