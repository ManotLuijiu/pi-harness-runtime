/**
 * The delegated approval.
 *
 * A deadline is not an answer. The operation continues at the deadline
 * only when the user delegated that outcome in advance, and only for the
 * kinds of operation the delegation names. The decision is recorded with
 * the source it really has, and exactly one resume is queued.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DelegationStore } from "../harness/delegation-store.ts";
import { ApprovalDecisionStore } from "../harness/approval-decision-store.ts";
import { DelegatedApprovalRuntime } from "../harness/delegated-approval-runtime.ts";
import { delegationCovers } from "../harness/delegated-approval-types.ts";

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "delegated-approval-"));
}

/**
 * A runtime with a pinned clock and a temporary store.
 */
function makeRuntime(dir, overrides = {}) {
	let now = 1000;
	const delegations = new DelegationStore(dir);
	const decisions = new ApprovalDecisionStore(dir);
	const delivered = [];
	const resumes = [];
	const runtime = new DelegatedApprovalRuntime({
		now: () => now,
		delegations,
		decisions,
		deliver: async (request) => {
			delivered.push(request);
			return { delivered: true, failures: [] };
		},
		resume: (request, decision) => {
			resumes.push({ request, decision });
		},
		...overrides,
	});
	return {
		runtime,
		delegations,
		decisions,
		delivered,
		resumes,
		setNow: (value) => {
			now = value;
		},
	};
}

/** The input of a request. */
function requestInput(overrides = {}) {
	return {
		requestId: "q-1",
		workspace: "/home/frappe/project",
		sessionId: "session-1",
		generation: 3,
		kind: "commit-and-push",
		operation: "create and push two commits",
		blocked: ["the push of the two commits"],
		// The request is due: the tests drive the expiry themselves. A
		// request that is not due yet is a different case, and it has its
		// own test.
		deadlineAt: 1000,
		...overrides,
	};
}

test("a delegation covers only the kinds it names", () => {
	const delegation = {
		id: "d-1",
		workspace: "/home/frappe/project",
		kinds: ["commit"],
		defaultOutcome: "continue",
		recordedAt: 1000,
	};
	assert.equal(
		delegationCovers(delegation, "commit", "/home/frappe/project", 2000),
		true,
	);
	// A delegation for a commit does not cover a push.
	assert.equal(
		delegationCovers(delegation, "push", "/home/frappe/project", 2000),
		false,
	);
	// A delegation of one workspace does not cover another one.
	assert.equal(
		delegationCovers(delegation, "commit", "/home/frappe/other", 2000),
		false,
	);
});

test("an expired delegation covers nothing", () => {
	const delegation = {
		id: "d-1",
		workspace: "/home/frappe/project",
		kinds: ["commit"],
		defaultOutcome: "continue",
		recordedAt: 1000,
		expiresAt: 2000,
	};
	assert.equal(
		delegationCovers(delegation, "commit", "/home/frappe/project", 1999),
		true,
	);
	assert.equal(
		delegationCovers(delegation, "commit", "/home/frappe/project", 2000),
		false,
	);
});

test("the request is delivered to the human", async () => {
	const dir = temporary();
	try {
		const { runtime, delivered } = makeRuntime(dir);
		const outcome = await runtime.open(requestInput());
		assert.equal(outcome.delivered, true);
		assert.equal(delivered.length, 1);
		assert.equal(delivered[0].operation, "create and push two commits");
		assert.equal(delivered[0].state, "pending");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delivery that fails leaves the operation blocked", async () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir, {
			deliver: async () => ({
				delivered: false,
				failures: ["no notification center"],
			}),
		});
		const outcome = await runtime.open(requestInput());
		assert.equal(outcome.delivered, false);
		assert.deepEqual(outcome.failures, ["no notification center"]);
		// The window did not start: the request is not pending any more.
		assert.equal(outcome.request.state, "expired");
		// And nothing was continued.
		const decision = runtime.expire("q-1");
		assert.equal(decision, null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the first answer of the human wins", async () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		await runtime.open(requestInput());
		const first = runtime.answer("q-1", "yes");
		assert.ok(first);
		assert.equal(first.source, "human");
		assert.equal(first.outcome, "yes");
		// A second click is a stale button.
		const second = runtime.answer("q-1", "no");
		assert.equal(second, null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline continues the operation under a delegation", async () => {
	const dir = temporary();
	try {
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput());
		const decision = runtime.expire("q-1");
		assert.ok(decision);
		assert.equal(decision.source, "delegated-timeout");
		assert.equal(decision.outcome, "yes");
		assert.equal(decision.delegationId, "d-1");
		// Exactly one resume.
		assert.equal(resumes.length, 1);
		assert.equal(resumes[0].request.requestId, "q-1");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline keeps the operation blocked without a delegation", async () => {
	const dir = temporary();
	try {
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput());
		const decision = runtime.expire("q-1");
		// No delegation covers the operation: the deadline decided nothing
		// and recorded nothing. A deadline is not a decision of the user,
		// and a recorded decision would close the question for the human.
		assert.equal(decision, null);
		// The delegation did not cover the operation, so nothing continued.
		assert.equal(resumes.length, 0);
		// The human may still answer: the deadline did not close the
		// question.
		const answered = runtime.answer("q-1", "yes");
		assert.ok(answered);
		assert.equal(answered.source, "human");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the answer of the human wins over the deadline", async () => {
	const dir = temporary();
	try {
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput());
		runtime.answer("q-1", "no");
		const decision = runtime.expire("q-1");
		assert.equal(decision, null);
		// The human said no: nothing continued.
		assert.equal(resumes.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline queues one resume, not two", async () => {
	const dir = temporary();
	try {
		const { runtime, delegations, resumes } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput());
		assert.ok(runtime.expire("q-1"));
		// A late timer, a poll and a duplicate click ask again.
		assert.equal(runtime.expire("q-1"), null);
		assert.equal(runtime.answer("q-1", "yes"), null);
		assert.equal(resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the decision survives a restart", async () => {
	const dir = temporary();
	try {
		const first = makeRuntime(dir);
		first.delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await first.runtime.open(requestInput());
		assert.ok(first.runtime.expire("q-1"));
		assert.equal(first.resumes.length, 1);

		// A new runtime reads the state of the machine: the decision of
		// the request was already claimed.
		const second = makeRuntime(dir);
		await second.runtime.open(requestInput());
		const decided = second.runtime.expire("q-1");
		// The durable record is the truth: the restart reads the decision
		// and does not decide anything a second time.
		assert.ok(decided);
		assert.equal(decided.source, "delegated-timeout");
		assert.equal(decided.outcome, "yes");
		assert.equal(second.resumes.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a paused request is not continued by the deadline", async () => {
	const dir = temporary();
	try {
		const { runtime, delegations, resumes } = makeRuntime(dir, {
			paused: () => true,
		});
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput());
		assert.equal(runtime.expire("q-1"), null);
		assert.equal(resumes.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a paused request keeps its decision for the moment the work runs again", async () => {
	const dir = temporary();
	try {
		let paused = true;
		const { runtime, delegations, resumes } = makeRuntime(dir, {
			paused: () => paused,
		});
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput());
		// The work is paused: the deadline does not decide.
		assert.equal(runtime.expire("q-1"), null);
		assert.equal(runtime.get("q-1").state, "pending");
		// The work runs again: the delegation of the user is not lost.
		paused = false;
		const decision = runtime.expire("q-1");
		assert.ok(decision);
		assert.equal(decision.source, "delegated-timeout");
		assert.equal(resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a failing settlement does not strand the decision", async () => {
	const dir = temporary();
	try {
		const { runtime, delegations, resumes } = makeRuntime(dir, {
			onDecided: () => {
				throw new Error("the session is gone");
			},
		});
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput());
		const decision = runtime.expire("q-1");
		// The decision was claimed: it is the truth of the request.
		assert.ok(decision);
		assert.equal(runtime.get("q-1").state, "claimed");
		// The continuation is queued anyway: a broken settlement must not
		// strand a decision that was made.
		assert.equal(resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a request of work that is over is not continued", async () => {
	const dir = temporary();
	try {
		const { runtime, delegations, resumes } = makeRuntime(dir, {
			active: () => false,
		});
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput());
		assert.equal(runtime.expire("q-1"), null);
		assert.equal(resumes.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline of the timer claims the decision", async () => {
	const dir = temporary();
	try {
		// The clock of the runtime is the wall clock here: the timer of the
		// runtime fires the claim on its own.
		const { runtime, delegations, resumes } = makeRuntime(dir, {
			now: () => Date.now(),
		});
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		await runtime.open(requestInput({ deadlineAt: Date.now() + 50 }));
		// The timer of the runtime fires the claim on its own.
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.equal(resumes.length, 1);
		assert.equal(runtime.get("q-1").state, "claimed");
		assert.equal(runtime.get("q-1").answer.source, "delegated-timeout");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a request that is not due yet is not decided", async () => {
	const dir = temporary();
	try {
		const { runtime, delegations, resumes, setNow } = makeRuntime(dir);
		delegations.record({
			id: "d-1",
			workspace: "/home/frappe/project",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const deadlineAt = 1000 + 5 * 60_000;
		await runtime.open(requestInput({ deadlineAt }));
		// The deadline has not passed: the request is not decided and
		// nothing is continued.
		setNow(deadlineAt - 1);
		assert.equal(runtime.expire("q-1"), null);
		assert.equal(resumes.length, 0);
		assert.equal(runtime.get("q-1").state, "pending");
		// The deadline passes: the request is decided.
		setNow(deadlineAt);
		const decision = runtime.expire("q-1");
		assert.ok(decision);
		assert.equal(decision.source, "delegated-timeout");
		assert.equal(resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the same question is not asked twice", async () => {
	const dir = temporary();
	try {
		const { runtime, delivered } = makeRuntime(dir);
		await runtime.open(requestInput());
		const second = await runtime.open(requestInput());
		assert.equal(second.delivered, true);
		assert.equal(delivered.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
