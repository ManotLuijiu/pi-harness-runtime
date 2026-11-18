/**
 * The delegated timeout, end to end.
 *
 * The deadline of a question is not an answer. The work continues at the
 * deadline only when the user delegated that outcome in advance, and the
 * decision is recorded with the source it really has.
 *
 * The path that is exercised here is the one of the harness: the
 * delegation is found for the workspace, the question is delivered, the
 * window starts with the delivery, and the deadline either continues the
 * work once or leaves it blocked.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPendingQuestionController } from "../packages/notification/dist/index.js";
import { DelegationStore } from "../harness/delegation-store.ts";
import { ApprovalDecisionStore } from "../harness/approval-decision-store.ts";
import { DelegatedApprovalRuntime } from "../harness/delegated-approval-runtime.ts";
import { operationKindFor } from "../harness/delegated-approval-types.ts";

const WORKSPACE = "/home/frappe/project";
const QUESTION_TEXT =
	"May I create and push these two commits in /home/frappe/project?";

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "delegated-timeout-"));
}

/**
 * The harness, as it is wired: the real stores, the real controller and
 * the real runtime.
 */
function makeHarness(dir, overrides = {}) {
	let now = 1000;
	const controller = createPendingQuestionController();
	const delegations = new DelegationStore(dir);
	const decisions = new ApprovalDecisionStore(dir);
	const resumes = [];
	const delivered = [];
	const order = [];
	const runtime = new DelegatedApprovalRuntime({
		now: () => now,
		delegations,
		decisions,
		deliver: async (request) => {
			delivered.push(request);
			return { delivered: true, failures: [] };
		},
		// The wiring of the harness: the request is settled before the
		// continuation is queued.
		onDecided: (request, decision) => {
			order.push("decided");
			controller.applyApproval(
				decision.outcome === "yes" ? "approve" : "reject",
				request.requestId,
				"pi",
			);
		},
		resume: (request, decision) => {
			order.push("resumed");
			resumes.push({ request, decision });
		},
		...overrides,
	});

	/**
	 * The flow of the harness: find the delegation, deliver the question
	 * and open the window of the answer.
	 */
	const ask = async () => {
		const kind = operationKindFor(QUESTION_TEXT);
		assert.equal(kind, "commit-and-push");
		const delegation = runtime.delegationFor({ kind, workspace: WORKSPACE });
		if (!delegation) return { kind, delegation: undefined, questionId: undefined };
		const question = controller.createQuestion({
			text: QUESTION_TEXT,
			sessionId: "session-1",
			workspacePath: WORKSPACE,
			jobId: "q-1",
			kind: "approval",
			askType: "approval",
			contextText: QUESTION_TEXT,
			relevance: "current-request",
		});
		await runtime.open(
			{
				requestId: question.requestId,
				workspace: WORKSPACE,
				sessionId: "session-1",
				generation: 1,
				kind,
				operation: QUESTION_TEXT,
				blocked: [QUESTION_TEXT],
				deadlineAt: now + 50,
			},
			{ delivered: true, failures: [] },
		);
		return { kind, delegation, questionId: question.requestId };
	};

	return {
		runtime,
		controller,
		delegations,
		decisions,
		resumes,
		delivered,
		order,
		ask,
		now: () => now,
		setNow: (value) => {
			now = value;
		},
	};
}

test("the question of a delegated operation names the kind", () => {
	assert.equal(operationKindFor(QUESTION_TEXT), "commit-and-push");
	assert.equal(operationKindFor("May I commit the change?"), "commit");
	assert.equal(operationKindFor("May I push the branch?"), "push");
	assert.equal(operationKindFor("May I deploy to production?"), "deploy");
	// An unknown operation is covered by nothing.
	assert.equal(operationKindFor("May I read the file?"), undefined);
	assert.equal(operationKindFor(undefined), undefined);
});

test("without a delegation the question asks nothing", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		const result = await harness.ask();
		assert.equal(result.delegation, undefined);
		assert.equal(result.questionId, undefined);
		assert.equal(harness.runtime.pending().length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline under a delegation continues the work once", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-1",
			workspace: WORKSPACE,
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const result = await harness.ask();
		assert.ok(result.delegation);
		assert.ok(result.questionId);

		// The window is open: the question waits for the human.
		assert.equal(harness.controller.getQuestion(result.questionId).state, "pending");
		assert.equal(harness.runtime.pending().length, 1);

		// The deadline passes.
		harness.setNow(1000 + 60_000);
		const decision = harness.runtime.expire(result.questionId);
		assert.ok(decision);
		assert.equal(decision.source, "delegated-timeout");
		assert.equal(decision.outcome, "yes");
		assert.equal(decision.delegationId, "d-1");
		// Exactly one continuation.
		assert.equal(harness.resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the deadline resolves the question before the continuation is queued", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-1",
			workspace: WORKSPACE,
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const result = await harness.ask();
		assert.ok(result.questionId);

		// The window is open: the question waits for the human.
		assert.equal(harness.controller.getQuestion(result.questionId).state, "pending");

		harness.setNow(1000 + 60_000);
		const decision = harness.runtime.expire(result.questionId);
		assert.ok(decision);

		// The question of the request is resolved: the judge is not asked
		// about a question that already has its answer.
		assert.equal(
			harness.controller.getQuestion(result.questionId).state,
			"resolved",
		);
		// The request was settled before the continuation was queued, so the
		// continuation never starts while the question is still open.
		assert.deepEqual(harness.order, ["decided", "resumed"]);
		assert.equal(harness.resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the answer of the human wins over the deadline", async () => {	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-1",
			workspace: WORKSPACE,
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const result = await harness.ask();

		// The human clicks [No].
		const applied = harness.controller.applyApproval(
			"reject",
			result.questionId,
			"telegram",
			{ notifyUser: false },
		);
		assert.equal(applied.applied, true);
		harness.runtime.answer(result.questionId, "no");

		// The deadline does not decide anything any more.
		harness.setNow(1000 + 60_000);
		assert.equal(harness.runtime.expire(result.questionId), null);
		assert.equal(harness.resumes.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation of another workspace covers nothing", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-1",
			workspace: "/home/frappe/other",
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const result = await harness.ask();
		assert.equal(result.delegation, undefined);
		assert.equal(result.questionId, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation for a commit does not cover a push", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-1",
			workspace: WORKSPACE,
			kinds: ["commit"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const result = await harness.ask();
		assert.equal(result.delegation, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the countdown of the question and the deadline of the delegation are one moment", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-1",
			workspace: WORKSPACE,
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const result = await harness.ask();
		assert.ok(result.questionId);

		// The countdown of the question counts down to the deadline of the
		// delegation: the two are one moment, so the countdown reaching zero
		// and the decision of the delegation happen together.
		const deadlineAt = harness.runtime.get(result.questionId).deadlineAt;
		assert.equal(deadlineAt, harness.now() + 50);

		// The deadline passes: the question is resolved and exactly one
		// continuation is queued.
		harness.setNow(deadlineAt);
		const decision = harness.runtime.expire(result.questionId);
		assert.ok(decision);
		assert.equal(harness.controller.getQuestion(result.questionId).state, "resolved");
		assert.deepEqual(harness.order, ["decided", "resumed"]);
		assert.equal(harness.resumes.length, 1);

		// A late tick of the countdown asks again: the decision was claimed,
		// so nothing happens a second time.
		assert.equal(harness.runtime.expire(result.questionId), null);
		assert.equal(harness.resumes.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
