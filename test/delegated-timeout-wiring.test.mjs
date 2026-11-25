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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPendingQuestionController } from "../packages/notification/dist/index.js";
import { DelegationStore } from "../harness/delegation-store.ts";
import { ApprovalDecisionStore } from "../harness/approval-decision-store.ts";
import { DelegatedApprovalRuntime } from "../harness/delegated-approval-runtime.ts";
import {
	operationKindFor,
	operationKindsFor,
	questionScope,
} from "../harness/delegated-approval-types.ts";
import { extractQuestionAction } from "../packages/jev-judge/dist/index.js";

const WORKSPACE = "/home/frappe/project";
const QUESTION_TEXT =
	"May I create and push these two commits in /home/frappe/project?";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

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
		const kinds = operationKindsFor(QUESTION_TEXT);
		const kind = operationKindFor(QUESTION_TEXT);
		assert.equal(kind, "commit-and-push");
		const delegation = runtime.delegationFor({ kinds, workspace: WORKSPACE });
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
				kinds,
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

test("a compound ask names every operation it proposes", () => {
	// The phrase of the speaker does not swallow the operation that came
	// with it: "my changes" is a phrase, "and push" is a second operation.
	assert.deepEqual(operationKindsFor("May I commit my changes and push?"), [
		"commit",
		"push",
	]);
	assert.deepEqual(operationKindsFor("May I commit and push?"), [
		"commit",
		"push",
	]);
	assert.deepEqual(operationKindsFor("May I commit and deploy?"), [
		"commit",
		"deploy",
	]);
	// A mention of the past names no operation.
	assert.deepEqual(operationKindsFor("May I check the service I deployed yesterday?"), []);
	// A denial names no operation.
	assert.deepEqual(operationKindsFor("May I not commit the change?"), []);
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

test("a delegation for a commit does not cover a request that also pushes", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		// The user delegated a commit. The question asks for a commit and a
		// push, so the delegation does not cover it.
		harness.delegations.record({
			id: "d-commit",
			workspace: WORKSPACE,
			kinds: ["commit"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const kinds = operationKindsFor(QUESTION_TEXT);
		// The order is the order of the words: "push" comes before
		// "commits" in the question.
		assert.deepEqual(kinds, ["push", "commit"]);
		const delegation = harness.runtime.delegationFor({ kinds, workspace: WORKSPACE });
		assert.equal(delegation, undefined);

		// The question asks nothing: without a delegation that covers every
		// operation, the deadline cannot continue the work.
		const result = await harness.ask();
		assert.equal(result.delegation, undefined);
		assert.equal(result.questionId, undefined);
		assert.equal(harness.runtime.pending().length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation of the push alone does not cover the request", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		// The user delegated the push alone. The question asks for a commit
		// and a push, so the delegation does not cover it. The kinds of the
		// question start with the push, so a check of the first kind alone
		// would let the delegation through: every kind of the request has
		// to be covered.
		harness.delegations.record({
			id: "d-push",
			workspace: WORKSPACE,
			kinds: ["push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const kinds = operationKindsFor(QUESTION_TEXT);
		assert.deepEqual(kinds, ["push", "commit"]);
		const delegation = harness.runtime.delegationFor({
			kinds,
			workspace: WORKSPACE,
		});
		assert.equal(delegation, undefined);

		// And the runtime decides nothing at the deadline.
		const result = await harness.ask();
		assert.equal(result.delegation, undefined);
		assert.equal(result.questionId, undefined);
		assert.equal(harness.runtime.pending().length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation of the commit and the push covers the request", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-both",
			workspace: WORKSPACE,
			kinds: ["commit", "push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const result = await harness.ask();
		assert.ok(result.delegation);
		assert.equal(result.delegation.id, "d-both");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delegation of the commit and the push does not cover a deploy", async () => {
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-both",
			workspace: WORKSPACE,
			kinds: ["commit-and-push"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const kinds = operationKindsFor("May I commit the change and deploy it?");
		assert.deepEqual(kinds, ["commit", "deploy"]);
		const delegation = harness.runtime.delegationFor({ kinds, workspace: WORKSPACE });
		assert.equal(delegation, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a proposal in a second sentence is part of the scope", () => {
	// The question proposes two operations in two sentences: the push is
	// the intent of the speaker ("I will push"), not a fact about the
	// past.
	const kinds = operationKindsFor(
		"May I commit the change? Then I will push to origin.",
	);
	assert.deepEqual(kinds, ["commit", "push"]);

	// A delegation of the commit alone does not cover the question.
	const dir = temporary();
	try {
		const harness = makeHarness(dir);
		harness.delegations.record({
			id: "d-commit",
			workspace: WORKSPACE,
			kinds: ["commit"],
			defaultOutcome: "continue",
			recordedAt: 500,
		});
		const delegation = harness.runtime.delegationFor({
			kinds,
			workspace: WORKSPACE,
		});
		assert.equal(delegation, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the scope of a long question is read from the complete question", () => {
	// The action of the question is shortened for the display: the push
	// lies behind the bound of the display.
	const filler = Array.from({ length: 40 }, () => "I will run the tests.").join(" ");
	const question = `May I commit the change? ${filler} Then I will push to origin.`;
	const action = extractQuestionAction(question);
	assert.ok(action !== undefined);
	assert.ok(action.length <= 600);
	assert.ok(action.length < question.length);

	// The shortened text names the commit alone.
	assert.deepEqual(operationKindsFor(action), ["commit"]);
	// The scope of the question names both.
	assert.deepEqual(questionScope(question), ["commit", "push"]);
});

test("the wiring reads the scope from the complete question", () => {
	// The scope of a delegation is read from the question itself: the
	// action that is extracted is shortened for the display, and the
	// shortened text would hide the operations behind the bound.
	const at = indexSource.indexOf("const delegatedKinds = questionScope(");
	assert.ok(at !== -1, "the scope of the question is read");
	const region = indexSource.slice(Math.max(0, at - 1_200), at + 400);
	assert.match(
		region,
		/const delegatedOperation = result\.questionText \?\? "";/,
		"the scope is the complete question",
	);
	assert.doesNotMatch(
		region,
		/questionAction \?\? result\.questionText/,
		"the shortened action never decides the scope",
	);
});
