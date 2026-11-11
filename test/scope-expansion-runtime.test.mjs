import { test } from "node:test";
import assert from "node:assert/strict";
import {
	ScopeExpansionRuntime,
} from "../harness/scope-expansion-runtime.ts";
import { SCOPE_EXPANSION_WINDOW_MS } from "../harness/scope-expansion.ts";

const start = 1_700_000_000_000;
const minute = 60_000;

const candidates = [
	{ id: "bd-1", title: "First issue" },
	{ id: "bd-2", title: "Second issue" },
];

/**
 * A runtime with a recording of everything it does.
 *
 * The clock is driven by the test, and the timer is a list of callbacks the
 * test fires itself.
 */
function runtime(overrides = {}) {
	const record = {
		deliveries: [],
		dispatches: [],
		questions: [],
		judgeCalls: 0,
		timers: [],
		logs: [],
	};

	const clock = { value: start };
	const deps = {
		now: () => clock.value,
		deliver: async (text, meta) => {
			record.deliveries.push({ text, meta });
			return { delivered: true, failures: [] };
		},
		judge: async () => {
			record.judgeCalls += 1;
			return {
				outcome: "approve",
				selectedIds: ["bd-1", "bd-2"],
				reasoning: "the work is bounded and the tests exist",
				source: "jev",
			};
		},
		dispatch: (proposal, ids) => {
			record.dispatches.push({ id: proposal.id, ids });
		},
		registerQuestion: (proposal) => {
			record.questions.push(proposal.id);
			return `q-${proposal.id}`;
		},
		setTimeout: (callback, ms) => {
			record.timers.push({ callback, ms });
			return record.timers.length;
		},
		clearTimeout: () => {},
		log: (message) => record.logs.push(message),
		...overrides,
	};

	return {
		record,
		clock,
		deps,
		controller: new ScopeExpansionRuntime(deps),
		/** Fire the timer of the runtime. */
		fire: async (index = 0) => {
			const timer = record.timers[index];
			if (!timer) throw new Error("no timer to fire");
			clock.value = start + timer.ms;
			await timer.callback();
		},
	};
}

function request(overrides = {}) {
	return {
		requestId: "r1",
		workspace: "/workspace",
		generation: 1,
		candidates,
		scope: "work on the two issues",
		validation: "the tests of the repository",
		risks: ["time"],
		...overrides,
	};
}

test("a proposal is delivered, the question is registered and the window starts", async () => {
	const rt = runtime();
	const proposal = await rt.controller.propose(request());

	assert.ok(proposal, "the proposal exists");
	assert.equal(rt.record.deliveries.length, 1);
	assert.equal(rt.record.deliveries[0].meta.kind, "proposal");
	assert.equal(rt.record.questions.length, 1);
	assert.equal(rt.record.timers.length, 1);
	assert.equal(rt.record.timers[0].ms, SCOPE_EXPANSION_WINDOW_MS);
	assert.equal(rt.record.dispatches.length, 0);
});

test("no proposal without a candidate", async () => {
	const rt = runtime();
	const proposal = await rt.controller.propose(request({ candidates: [] }));

	assert.equal(proposal, null);
	assert.equal(rt.record.deliveries.length, 0);
	assert.equal(rt.record.timers.length, 0);
});

test("the evaluation happens at the deadline, the decision is delivered and the work starts", async () => {
	const rt = runtime();
	await rt.controller.propose(request());
	await rt.fire();

	assert.equal(rt.record.judgeCalls, 1);
	assert.equal(rt.record.deliveries.length, 2);
	assert.equal(rt.record.deliveries[1].meta.kind, "decision");
	assert.equal(rt.record.dispatches.length, 1);
	assert.deepEqual(rt.record.dispatches[0].ids, ["bd-1", "bd-2"]);
});

test("the evaluation happens only once", async () => {
	const rt = runtime();
	await rt.controller.propose(request());
	await rt.fire();
	await rt.fire();

	assert.equal(rt.record.judgeCalls, 1);
	assert.equal(rt.record.dispatches.length, 1);
});

test("the answer of the human starts the exact work of the proposal", async () => {
	const rt = runtime();
	const proposal = await rt.controller.propose(request());
	const result = await rt.controller.answer(proposal.id, "approve", "yes, do it");

	assert.equal(result.started, true);
	assert.equal(rt.record.judgeCalls, 0);
	assert.deepEqual(rt.record.dispatches[0].ids, ["bd-1", "bd-2"]);
});

test("the rejection of the human starts nothing", async () => {
	const rt = runtime();
	const proposal = await rt.controller.propose(request());
	const result = await rt.controller.answer(proposal.id, "reject", "not now");

	assert.equal(result.started, false);
	assert.equal(rt.record.dispatches.length, 0);
});

test("the first answer wins", async () => {
	const rt = runtime();
	const proposal = await rt.controller.propose(request());
	await rt.controller.answer(proposal.id, "approve", "yes");
	const second = await rt.controller.answer(proposal.id, "reject", "no");

	assert.equal(second.started, false);
	assert.deepEqual(rt.record.dispatches[0].ids, ["bd-1", "bd-2"]);
	assert.equal(rt.record.dispatches.length, 1);
});

test("a rejection that arrives after the delivery prevents the work", async () => {
	let human = undefined;
	const rt = runtime({
		latestHumanDecision: () => human,
	});
	const proposal = await rt.controller.propose(request());
	// The human rejects while the decision is on its way.
	human = "reject";
	await rt.fire();

	assert.equal(rt.record.dispatches.length, 0);
	const state = rt.controller.get(proposal.id);
	assert.equal(state.state, "stopped");
	assert.match(state.stopReason ?? "", /rejected/);
});

test("a delivery failure leaves the work stopped", async () => {
	const rt = runtime({
		deliver: async () => ({ delivered: false, failures: ["telegram", "line"] }),
	});
	const proposal = await rt.controller.propose(request());

	assert.equal(proposal, null);
	assert.equal(rt.record.dispatches.length, 0);
});

test("a failed evaluation starts nothing", async () => {
	const rt = runtime({
		judge: async () => {
			throw new Error("the model is down");
		},
	});
	await rt.controller.propose(request());
	await rt.fire();

	assert.equal(rt.record.dispatches.length, 0);
	const deliveries = rt.record.deliveries;
	assert.equal(deliveries.length, 2);
	assert.match(deliveries[1].text, /wait/i);
});

test("the group completion stops the session and refuses a second proposal of the generation", async () => {
	let finished = false;
	const rt = runtime({
		groupFinished: () => finished,
	});
	await rt.controller.propose(request());
	await rt.fire();
	assert.equal(rt.record.dispatches.length, 1);

	finished = true;
	await rt.controller.checkGroupFinished();
	const state = rt.controller.get("scope-1-bd-1");
	assert.equal(state.state, "finished");

	const second = await rt.controller.propose(request());
	assert.equal(second, null);
});

test("the runtime disposes its timers", async () => {
	const rt = runtime();
	await rt.controller.propose(request());
	assert.equal(rt.record.timers.length, 1);
	rt.controller.dispose();
});
