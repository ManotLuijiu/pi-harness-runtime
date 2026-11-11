import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MAX_SCOPE_CANDIDATES,
	SCOPE_EXPANSION_WINDOW_MS,
	ScopeExpansionController,
	authorizedScope,
	createScopeProposal,
	scopeDecisionMessage,
	scopeProposalMessage,
} from "../harness/scope-expansion.ts";

const now = 1_700_000_000_000;
const minute = 60_000;

const candidates = [
	{ id: "bd-1", title: "First issue" },
	{ id: "bd-2", title: "Second issue" },
];

function proposal(overrides = {}) {
	return createScopeProposal({
		id: "p1",
		sessionId: "s1",
		requestId: "r1",
		generation: 1,
		workspace: "/workspace",
		candidates,
		proposedIds: ["bd-1", "bd-2"],
		scope: "work on the two issues",
		validation: "the tests of the repository",
		risks: ["time"],
		now,
		...overrides,
	});
}

/** A controller with a recording of everything it does. */
function controller(overrides = {}) {
	const record = {
		delivered: [],
		dispatched: [],
		judged: 0,
		logs: [],
	};
	const instance = new ScopeExpansionController({
		now: () => record.clock ?? now,
		deliver: async (text, meta) => {
			record.delivered.push({ text, meta });
			return record.deliveryResult ?? { delivered: true, failures: [] };
		},
		judge: async (candidate) => {
			record.judged += 1;
			return (
				record.judgement ?? {
					outcome: "approve",
					selectedIds: candidate.proposedIds,
					reasoning: "the work continues the request",
					source: "jev",
				}
			);
		},
		dispatch: (candidate, ids) => {
			record.dispatched.push({ id: candidate.id, ids });
		},
		log: (message) => record.logs.push(message),
		...overrides,
	});
	return { instance, record };
}

test("a proposal names a bounded subset of its candidates", () => {
	const created = proposal({ proposedIds: ["bd-1", "bd-9"] });
	assert.deepEqual(created.proposedIds, ["bd-1"]);
	assert.equal(created.deadlineAt, now + SCOPE_EXPANSION_WINDOW_MS);
	assert.equal(created.state, "proposed");
});

test("a proposal without a known id is refused", () => {
	assert.throws(
		() => proposal({ proposedIds: ["bd-9"] }),
		/at least one candidate id/,
	);
});

test("a proposal keeps at most ten candidates", () => {
	const many = Array.from({ length: 20 }, (_, index) => ({
		id: `bd-${index}`,
		title: `Issue ${index}`,
	}));
	const created = proposal({
		candidates: many,
		proposedIds: ["bd-0"],
	});
	assert.equal(created.candidates.length, MAX_SCOPE_CANDIDATES);
});

test("the message of the proposal names the exact ids and the deadline", () => {
	const message = scopeProposalMessage(proposal());
	assert.match(message, /bd-1, bd-2/);
	assert.match(message, /\/workspace/);
	assert.match(message, /the tests of the repository/);
	assert.match(message, new RegExp(new Date(now + SCOPE_EXPANSION_WINDOW_MS).toISOString()));
});

test("the message of the decision names the outcome and the action", () => {
	const created = proposal();
	const message = scopeDecisionMessage(
		created,
		{
			outcome: "approve",
			selectedIds: ["bd-1"],
			reasoning: "the issues continue the request",
			source: "jev",
		},
		"starting the selected work",
	);
	assert.match(message, /approve/);
	assert.match(message, /bd-1/);
	assert.match(message, /starting the selected work/);
});

test("a decision may only name the ids of the proposal", () => {
	const created = proposal();
	const scope = authorizedScope(created, {
		outcome: "approve",
		selectedIds: ["bd-1", "bd-9"],
		reasoning: "",
		source: "jev",
	});
	assert.deepEqual(scope.ids, ["bd-1"]);
});

test("a decision that approves nothing authorizes nothing", () => {
	const created = proposal();
	const scope = authorizedScope(created, {
		outcome: "approve",
		selectedIds: [],
		reasoning: "",
		source: "jev",
	});
	assert.deepEqual(scope.ids, []);
	assert.ok(scope.reason);
});

test("a generation has at most one open proposal", () => {
	const { instance } = controller();
	assert.equal(instance.register(proposal()), true);
	assert.equal(instance.register(proposal({ id: "p2" })), false);
});

test("a proposal of a closed generation is refused", () => {
	const { instance } = controller();
	instance.register(proposal());
	instance.finishGroup("p1");
	assert.equal(instance.register(proposal({ id: "p2" })), false);
});

test("the answer of the human wins over the proposal", () => {
	const { instance, record } = controller();
	instance.register(proposal());
	const decision = instance.answer("p1", "approve", "yes");
	assert.equal(decision.source, "human");
	assert.deepEqual(decision.selectedIds, ["bd-1", "bd-2"]);
	// A second answer is refused: the first answer wins.
	assert.equal(instance.answer("p1", "reject", "no"), null);
	assert.equal(record.judged, 0);
});

test("the proposal is evaluated once, and only after the deadline", async () => {
	const { instance, record } = controller();
	instance.register(proposal());
	assert.equal(await instance.evaluateDue("p1"), null);
	assert.equal(record.judged, 0);
	record.clock = now + SCOPE_EXPANSION_WINDOW_MS;
	const decision = await instance.evaluateDue("p1");
	assert.equal(decision.source, "jev");
	assert.equal(record.judged, 1);
	// The evaluation does not happen twice.
	assert.equal(await instance.evaluateDue("p1"), null);
	assert.equal(record.judged, 1);
});

test("the answer of the human discards an evaluation that runs meanwhile", async () => {
	const { instance, record } = controller();
	instance.register(proposal());
	record.clock = now + SCOPE_EXPANSION_WINDOW_MS;
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const waiting = controller({
		judge: async (candidate) => {
			record.judged += 1;
			await gate;
			return {
				outcome: "approve",
				selectedIds: candidate.proposedIds,
				reasoning: "",
				source: "jev",
			};
		},
	});
	waiting.instance.register(proposal());
	record.clock = now + SCOPE_EXPANSION_WINDOW_MS;
	const evaluation = waiting.instance.evaluateDue("p1");
	waiting.instance.answer("p1", "reject", "no");
	release();
	assert.equal(await evaluation, null);
	assert.equal(waiting.instance.get("p1").decision.source, "human");
});

test("a failing evaluation is a wait, not a decision", async () => {
	const { instance, record } = controller({
		judge: async () => {
			throw new Error("the judge is not reachable");
		},
	});
	instance.register(proposal());
	record.clock = now + SCOPE_EXPANSION_WINDOW_MS;
	const decision = await instance.evaluateDue("p1");
	assert.equal(decision.outcome, "wait");
	assert.equal(decision.failed, true);
});

test("the decision is delivered before the work starts", async () => {
	const { instance, record } = controller();
	instance.register(proposal());
	record.clock = now + SCOPE_EXPANSION_WINDOW_MS;
	await instance.evaluateDue("p1");
	const outcome = await instance.applyDecision("p1");
	assert.equal(outcome.started, true);
	assert.equal(record.delivered.length, 1);
	assert.equal(record.delivered[0].meta.kind, "decision");
	assert.equal(record.dispatched.length, 1);
	assert.deepEqual(record.dispatched[0].ids, ["bd-1", "bd-2"]);
});

test("a decision that cannot be delivered leaves the work stopped", async () => {
	const { instance, record } = controller({
		deliver: async () => ({ delivered: false, failures: ["telegram"] }),
	});
	instance.register(proposal());
	record.clock = now + SCOPE_EXPANSION_WINDOW_MS;
	await instance.evaluateDue("p1");
	const outcome = await instance.applyDecision("p1");
	assert.equal(outcome.started, false);
	assert.equal(record.dispatched.length, 0);
	assert.equal(instance.get("p1").state, "stopped");
});

test("a proposal that cannot be delivered starts no countdown", async () => {
	const { instance, record } = controller({
		deliver: async () => ({ delivered: false, failures: ["line"] }),
	});
	const created = proposal();
	instance.register(created);
	assert.equal(await instance.deliverProposal(created), false);
	assert.equal(created.state, "stopped");
	assert.equal(record.dispatched.length, 0);
});

test("a decision that authorizes nothing starts nothing", async () => {
	const { instance, record } = controller({
		judge: async () => ({
			outcome: "reject",
			selectedIds: [],
			reasoning: "the backlog is not part of the request",
			source: "jev",
		}),
	});
	instance.register(proposal());
	record.clock = now + SCOPE_EXPANSION_WINDOW_MS;
	await instance.evaluateDue("p1");
	const outcome = await instance.applyDecision("p1");
	assert.equal(outcome.started, false);
	assert.equal(record.dispatched.length, 0);
});

test("the finished group closes the generation", () => {
	const { instance, record } = controller();
	instance.register(proposal());
	instance.finishGroup("p1");
	assert.equal(instance.get("p1").state, "finished");
	assert.equal(record.dispatched.length, 0);
	assert.ok(record.logs.length > 0);
});
