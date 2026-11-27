/**
 * The countdown of a Frappe operation.
 *
 * The countdown is the confirmation of the human that expires. The expiry
 * is not an answer: the operation runs only when the permission that
 * stands still covers it, and the check before the dispatch pins the
 * proposal that was assessed.
 *
 * The tests are behavioural: they arm a countdown, let the deadline pass
 * and look at what the owner did - the message to the agent, the row of
 * the pending actions and the outcome of the expiry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	FrappeCountdownDispatcher,
	authorizedMessage,
	refusedMessage,
} from "../harness/frappe-countdown.ts";
import {
	FRAPPE_PROJECT_RULE_ENV,
	FRAPPE_STANDING_GRANT_ENV,
	readFrappePolicyConfig,
	readFrappeProjectRule,
	readFrappeStandingGrant,
} from "../harness/frappe-policy-config.ts";
import { assessFrappeOperation } from "../harness/frappe-lifecycle-policy.ts";
import { createPendingActionRegistry } from "../harness/pending-actions.ts";

/** The permission that stands for the operation of the tests. */
const grant = {
	source: "standing",
	scope: "the migrations of the site demo.local",
	site: "demo.local",
	effects: ["data-migration"],
};

/** The owner of a DocType of the app of the operation. */
const ownOwnership = {
	doctype: "Item",
	ownerApp: "warehouse_app",
	namespace: "warehouse_app",
	module: "stock",
	sourceJson:
		"/bench/apps/warehouse_app/warehouse_app/stock/doctype/item/item.json",
	standard: true,
	databaseOnly: false,
	customFields: [],
	fixtures: [],
	evidence: [],
	ambiguous: false,
};

/** The assessment of an operation that the permission covers. */
function assessmentOf(overrides = {}) {
	return assessFrappeOperation({
		requestGeneration: 7,
		proposal:
			"bench --site demo.local execute warehouse_app.setup.install.after_install",
		mechanism: "hook",
		target: {
			bench: "/bench",
			app: "warehouse_app",
			namespace: "warehouse_app",
			module: "stock",
			site: "demo.local",
			function: "warehouse_app.setup.install.after_install",
		},
		ownership: ownOwnership,
		insideConvention: {
			inside: true,
			reason: "the routine is in the setup directory",
			verified: true,
		},
		registration: { hook: "after_install" },
		workload: { bounded: true, steps: 3, verified: true },
		idempotency: "verified",
		verification: "unverified",
		authorization: grant,
		...overrides,
	});
}

/** The owner of the countdowns, with a pinned clock. */
function makeOwner(options = {}) {
	let now = 1000;
	const pending = createPendingActionRegistry();
	const messages = [];
	const dispatcher = new FrappeCountdownDispatcher({
		pending,
		now: () => now,
		state: options.state ?? (() => ({
			requestGeneration: 7,
			authorization: grant,
		})),
		dispatch: options.dispatch ?? (async (message) => {
			messages.push(message);
			return { dispatched: true };
		}),
		setTimeout: options.setTimeout ?? (() => null),
		clearTimeout: options.clearTimeout ?? (() => undefined),
	});
	const entry = {
		actionId: "frappe-the-operation",
		identity: "the-operation",
		assessment: assessmentOf(),
		deadlineAt: 2000,
		generation: 7,
		sessionId: "session-1",
		workspace: "/bench",
		proposal:
			"bench --site demo.local execute warehouse_app.setup.install.after_install",
	};
	return {
		pending,
		messages,
		dispatcher,
		entry,
		setNow: (value) => (now = value),
		remember: () => dispatcher.remember(entry),
	};
}

test("the expiry of a countdown tells the agent that the operation may run", async () => {
	const owner = makeOwner();
	owner.remember();
	owner.setNow(2000);

	const outcomes = await owner.dispatcher.fire();

	assert.equal(outcomes.length, 1);
	assert.equal(outcomes[0].kind, "authorized");
	assert.match(outcomes[0].reason, /permission covers the operation/);
	assert.equal(owner.messages.length, 1);
	assert.match(owner.messages[0], /confirmation of the operation expired/);
	assert.match(owner.messages[0], /You may run the operation now/);
	// The row leaves the registry when the countdown fired.
	assert.equal(owner.pending.list().length, 0);
	assert.equal(owner.dispatcher.list().length, 0);
});

test("a countdown that is not due is not fired", async () => {
	const owner = makeOwner();
	owner.remember();
	owner.setNow(1500);

	const outcomes = await owner.dispatcher.fire();

	assert.equal(outcomes.length, 0);
	assert.equal(owner.messages.length, 0);
	assert.equal(owner.dispatcher.list().length, 1);
	// The row of the countdown is the one of the registry.
	assert.equal(owner.pending.list().length, 1);
	assert.equal(owner.pending.list()[0].dueAt, 2000);
});

test("a request that was replaced authorizes nothing", async () => {
	const owner = makeOwner({
		state: () => ({
			requestGeneration: 8,
			authorization: grant,
		}),
	});
	owner.remember();
	owner.setNow(2000);

	const outcomes = await owner.dispatcher.fire();

	assert.equal(outcomes[0].kind, "blocked");
	assert.match(outcomes[0].reason, /not the request that runs/);
	assert.equal(owner.messages.length, 1);
	assert.match(owner.messages[0], /may not run/);
	assert.match(owner.messages[0], /Do not run it/);
	// The row stays and names the reason: the operator sees why it ended.
	assert.equal(owner.pending.list()[0].state, "blocked");
	assert.match(owner.pending.list()[0].reason, /not the request that runs/);
});

test("a permission that ended blocks the expiry", async () => {
	const owner = makeOwner({
		state: () => ({
			requestGeneration: 7,
			// The permission that stands expired before the deadline.
			authorization: { ...grant, expiresAt: 1500 },
		}),
	});
	owner.remember();
	owner.setNow(2000);

	const outcomes = await owner.dispatcher.fire();

	assert.equal(outcomes[0].kind, "blocked");
	assert.match(outcomes[0].reason, /permission of the operation is not valid/);
	assert.match(owner.messages[0], /Do not run it/);
});

test("a dispatch that the session refused keeps the countdown", async () => {
	let refused = true;
	const sent = [];
	const owner = makeOwner({
		dispatch: async (message) => {
			sent.push(message);
			if (refused) return { dispatched: false, reason: "session not idle" };
			return { dispatched: true };
		},
	});
	owner.remember();
	owner.setNow(2000);

	const outcomes = await owner.dispatcher.fire();

	assert.equal(outcomes[0].kind, "authorized");
	assert.match(outcomes[0].reason, /dispatch was refused/);
	// The countdown is still there: the authorization is not lost.
	assert.equal(owner.dispatcher.list().length, 1);
	assert.equal(owner.pending.list().length, 1);

	// The refusal waits before the next try: the countdown is not due yet.
	assert.equal(owner.dispatcher.due().length, 0);
	assert.equal((await owner.dispatcher.fire()).length, 0);
	assert.equal(sent.length, 1);

	// The session is free again: the countdown fires and the operation runs.
	refused = false;
	owner.setNow(2000 + 5000);
	const second = await owner.dispatcher.fire();
	assert.equal(second[0].kind, "authorized");
	assert.match(second[0].reason, /permission covers the operation/);
	assert.equal(owner.pending.list().length, 0);
	// The message that was refused is the one that is sent again.
	assert.equal(sent.length, 2);
	assert.equal(sent[0], sent[1]);
});

test("a refused countdown waits before it is tried again", async () => {
	const timers = [];
	const owner = makeOwner({
		dispatch: async () => ({ dispatched: false, reason: "session not idle" }),
		setTimeout: (callback, delayMs) => {
			timers.push({ callback, delayMs });
			return timers.length;
		},
	});
	owner.remember();
	owner.setNow(2000);

	await owner.dispatcher.fire();

	// The countdown is still there, but it is not due before its try.
	assert.equal(owner.dispatcher.list().length, 1);
	assert.equal(owner.dispatcher.due().length, 0);
	// The timer waits: the delay of the next try is not zero.
	const armed = timers[timers.length - 1];
	assert.ok(armed.delayMs > 0, `the delay was ${armed.delayMs}ms`);
});

test("a refusal that lasts a minute does not spin", async () => {
	let attempts = 0;
	const timers = [];
	const owner = makeOwner({
		dispatch: async () => {
			attempts += 1;
			return { dispatched: false, reason: "session not idle" };
		},
		setTimeout: (callback, delayMs) => {
			timers.push({ callback, delayMs });
			return timers.length;
		},
	});
	owner.remember();
	const started = 2000;
	let now = started;
	owner.setNow(now);
	while (now - started < 60_000) {
		await owner.dispatcher.fire();
		const armed = timers[timers.length - 1];
		if (!armed || armed.delayMs <= 0) break;
		now += armed.delayMs;
		owner.setNow(now);
	}
	// A minute of refusal is a bounded number of tries, not a loop.
	assert.ok(
		attempts <= 6,
		`the countdown tried ${attempts} times in a minute`,
	);
});

test("a countdown that was refused delivers once when the session is free again", async () => {
	let refused = true;
	const sent = [];
	const owner = makeOwner({
		dispatch: async (message) => {
			sent.push(message);
			return refused
				? { dispatched: false, reason: "session not idle" }
				: { dispatched: true };
		},
	});
	owner.remember();
	owner.setNow(2000);
	await owner.dispatcher.fire();
	assert.equal(sent.length, 1);
	// Before the wait the countdown does not try again.
	assert.equal((await owner.dispatcher.fire()).length, 0);
	assert.equal(sent.length, 1);
	// After the wait the session is free: the operation is authorized once.
	refused = false;
	owner.setNow(2000 + 5000);
	const outcomes = await owner.dispatcher.fire();
	assert.equal(outcomes[0].kind, "authorized");
	assert.match(outcomes[0].reason, /permission covers the operation/);
	assert.equal(sent.length, 2);
	assert.equal(owner.dispatcher.list().length, 0);
	assert.equal(owner.pending.list().length, 0);
});

test("a dispatch that fails does not throw into the timer", async () => {
	const owner = makeOwner({
		dispatch: async () => {
			throw new Error("the session is gone");
		},
	});
	owner.remember();
	owner.setNow(2000);

	const outcomes = await owner.dispatcher.fire();

	// The failure is a refusal: it authorizes nothing and it does not throw.
	assert.equal(outcomes[0].kind, "authorized");
	assert.match(outcomes[0].reason, /dispatch was refused/);
	// The countdown stays and it waits for its next try.
	assert.equal(owner.dispatcher.list().length, 1);
	assert.equal(owner.dispatcher.due().length, 0);
});

test("a countdown that was cancelled while it waited delivers nothing", async () => {
	const sent = [];
	const owner = makeOwner({
		dispatch: async (message) => {
			sent.push(message);
			return { dispatched: false, reason: "session not idle" };
		},
	});
	owner.remember();
	owner.setNow(2000);
	await owner.dispatcher.fire();
	assert.equal(sent.length, 1);

	// The request ends while the countdown waits.
	assert.equal(owner.dispatcher.forget(7), 1);
	owner.setNow(2000 + 10_000);
	const outcomes = await owner.dispatcher.fire();

	assert.equal(outcomes.length, 0);
	assert.equal(sent.length, 1);
	assert.equal(owner.pending.list().length, 0);
});

test("the request that ends forgets its countdowns", async () => {
	const owner = makeOwner();
	owner.remember();
	owner.setNow(2000);

	const forgotten = owner.dispatcher.forget(7);

	assert.equal(forgotten, 1);
	assert.equal(owner.dispatcher.list().length, 0);
	assert.equal(owner.pending.list().length, 0);

	// A forgotten countdown never fires.
	const outcomes = await owner.dispatcher.fire();
	assert.equal(outcomes.length, 0);
	assert.equal(owner.messages.length, 0);
});

test("the messages of the countdown name the operation and the reason", () => {
	const entry = {
		actionId: "frappe-the-operation",
		identity: "the-operation",
		assessment: assessmentOf(),
		deadlineAt: 2000,
		generation: 7,
		sessionId: "session-1",
		workspace: "/bench",
		proposal: "bench --site demo.local migrate",
	};
	const authorized = authorizedMessage(entry);
	assert.match(authorized, /bench --site demo.local migrate/);
	assert.match(authorized, /the-operation/);
	// The message never says that the human approved it.
	assert.doesNotMatch(authorized, /approved/i);
	const refused = refusedMessage(entry, "the permission ended");
	assert.match(refused, /the permission ended/);
	assert.match(refused, /Do not run it/);
});

test("the configuration of the policy refuses what it cannot read", () => {
	// An unknown rule is no rule.
	assert.equal(readFrappeProjectRule("confirm"), "confirm");
	assert.equal(readFrappeProjectRule("CONFIRM"), "confirm");
	assert.equal(readFrappeProjectRule("anything-else"), undefined);
	assert.equal(readFrappeProjectRule(undefined), undefined);

	// A permission without a scope covers nothing.
	assert.equal(readFrappeStandingGrant("not json"), undefined);
	assert.equal(readFrappeStandingGrant("{}"), undefined);
	assert.equal(readFrappeStandingGrant('{"scope":""}'), undefined);
	// A permission that names an effect that does not exist is refused.
	assert.equal(
		readFrappeStandingGrant('{"scope":"the migrations","effects":["nonsense"]}'),
		undefined,
	);
	const grantOf = readFrappeStandingGrant(
		'{"scope":"the migrations of demo.local","site":"demo.local","effects":["data-migration"]}',
	);
	assert.equal(grantOf?.source, "standing");
	assert.equal(grantOf?.scope, "the migrations of demo.local");
	assert.equal(grantOf?.site, "demo.local");
	assert.deepEqual(grantOf?.effects, ["data-migration"]);

	// The configuration of the session reads both.
	const config = readFrappePolicyConfig({
		[FRAPPE_PROJECT_RULE_ENV]: "confirm",
		[FRAPPE_STANDING_GRANT_ENV]:
			'{"scope":"the migrations of demo.local","effects":["data-migration"]}',
	});
	assert.equal(config.projectRule, "confirm");
	assert.equal(config.standingGrant?.scope, "the migrations of demo.local");

	// Without the environment the policy has no rule and no permission.
	const empty = readFrappePolicyConfig({});
	assert.equal(empty.projectRule, undefined);
	assert.equal(empty.standingGrant, undefined);
});
