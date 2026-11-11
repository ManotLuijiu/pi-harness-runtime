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
	assert.equal(created.candidates.length, 1);
	assert.equal(created.proposedIds.length, 1);
});

test("a proposal of many known ids keeps at most ten of them", () => {
	const many = Array.from({ length: 20 }, (_, index) => ({
		id: `bd-${index}`,
		title: `Issue ${index}`,
	}));
	const created = proposal({
		candidates: many,
		proposedIds: many.map((candidate) => candidate.id),
	});
	// The bound is applied to the proposed ids, and every id of the caller
	// is checked against the whole list of the candidates: a bound that
	// dropped a known id would refuse a proposal of ids that it knew.
	assert.equal(created.proposedIds.length, MAX_SCOPE_CANDIDATES);
	assert.equal(created.candidates.length, MAX_SCOPE_CANDIDATES);
	assert.deepEqual(
		created.proposedIds,
		many.slice(0, MAX_SCOPE_CANDIDATES).map((candidate) => candidate.id),
	);
});

test("the choices of the caller are the choices of the proposal", () => {
	const created = proposal({ choices: ["run the named issues", "keep it closed"] });
	assert.deepEqual(created.choices, ["run the named issues", "keep it closed"]);
	assert.match(scopeProposalMessage(created), /run the named issues/);
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

test("the message of the decision names the proposal and the authorized scope", () => {
	const created = proposal();
	const message = scopeDecisionMessage(
		created,
		{
			outcome: "approve",
			selectedIds: ["bd-1", "bd-9"],
			reasoning: "",
			source: "jev",
		},
		"starting the selected work",
		["bd-1"],
	);
	assert.match(message, /Proposal: p1\./);
	assert.match(message, /Scope: bd-1\./);
	assert.doesNotMatch(message, /bd-9/, "an id that is not authorized is not named");
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

test("a decision that failed is a wait, not a decision", async () => {
	const { instance, record } = controller({
		judge: async (candidate) => ({
			outcome: "approve",
			selectedIds: candidate.proposedIds,
			reasoning: "the model is down",
			source: "jev",
			failed: true,
		}),
	});
	instance.register(proposal());
	record.clock = now + SCOPE_EXPANSION_WINDOW_MS;
	const decision = await instance.evaluateDue("p1");
	assert.equal(decision.outcome, "wait");
	assert.deepEqual(decision.selectedIds, []);
	const outcome = await instance.applyDecision("p1");
	assert.equal(outcome.started, false);
	assert.equal(record.dispatched.length, 0);
});

test("the group of a proposal starts once", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const record = { dispatched: [], delivered: [] };
	let clock = now;
	const instance = new ScopeExpansionController({
		now: () => clock,
		deliver: async (text, meta) => {
			record.delivered.push({ text, meta });
			// The human answers while the decision is on its way.
			if (record.delivered.length === 1) {
				instance.answer("p1", "approve", "the human approved it");
			}
			await gate;
			return { delivered: true, failures: [] };
		},
		judge: async (candidate) => ({
			outcome: "approve",
			selectedIds: candidate.proposedIds,
			reasoning: "",
			source: "jev",
		}),
		dispatch: (candidate, ids) => {
			record.dispatched.push({ id: candidate.id, ids });
		},
	});
	instance.register(proposal());
	clock = now + SCOPE_EXPANSION_WINDOW_MS;
	await instance.evaluateDue("p1");
	const first = instance.applyDecision("p1");
	// The answer of the human starts a second application of the same
	// proposal.
	const second = instance.applyDecision("p1");
	release();
	await first;
	await second;
	assert.equal(record.dispatched.length, 1, "the group starts once");
});

test("the first answer of the human wins over the store", async () => {
	const { instance, record } = controller({
		latestHumanDecision: () => "reject",
	});
	instance.register(proposal());
	instance.answer("p1", "approve", "the human approved it");
	await instance.applyDecision("p1");
	assert.equal(record.dispatched.length, 1, "the work starts");
	assert.deepEqual(record.dispatched[0].ids, ["bd-1", "bd-2"]);
});

test("a rejection of the human that arrives during the delivery prevents the work", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const record = { dispatched: [], delivered: [] };
	let clock = now;
	const instance = new ScopeExpansionController({
		now: () => clock,
		deliver: async (text, meta) => {
			record.delivered.push({ text, meta });
			if (record.delivered.length === 1) {
				// The human rejects while the decision is on its way.
				instance.answer("p1", "reject", "no");
			}
			await gate;
			return { delivered: true, failures: [] };
		},
		judge: async (candidate) => ({
			outcome: "approve",
			selectedIds: candidate.proposedIds,
			reasoning: "",
			source: "jev",
		}),
		dispatch: (candidate, ids) => {
			record.dispatched.push({ id: candidate.id, ids });
		},
	});
	instance.register(proposal());
	clock = now + SCOPE_EXPANSION_WINDOW_MS;
	await instance.evaluateDue("p1");
	const applied = instance.applyDecision("p1");
	release();
	const outcome = await applied;
	assert.equal(outcome.started, false);
	assert.equal(record.dispatched.length, 0);
});

test("every closed generation is remembered", () => {
	const { instance } = controller();
	instance.register(proposal({ id: "p1", generation: 1 }));
	instance.finishGroup("p1");
	instance.register(proposal({ id: "p2", generation: 2 }));
	instance.finishGroup("p2");
	// The first generation is closed as well: the approval of one group is
	// not the approval of the next one.
	assert.equal(instance.register(proposal({ id: "p3", generation: 1 })), false);
});
