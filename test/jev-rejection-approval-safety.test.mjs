/**
 * The approval of the human resumes the work. It does not run the action
 * and it does not finish the work.
 *
 * The judge refused an operation and the harness asked the human about it
 * with working buttons. The answer "yes" is an answer to that question:
 * the work continues, and whatever the agent does with it goes through the
 * checks of the repository like every other action. An approval is not an
 * execution, and it is not a passed validation.
 *
 * The parts are the real ones: the real pending question controller, the
 * real notification center, the real escalation runtime and the real
 * continuation controller. Only the network is captured.
 */

import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	NotificationCenter,
	createPendingQuestionController,
} from "../packages/notification/dist/index.js";
import { TodoContinuationController } from "../packages/jev-judge/dist/index.js";
import {
	buildJevApprovalContinuation,
	decideApprovalResume,
	JevRejectionEscalationRuntime,
} from "../harness/jev-rejection-escalation.ts";

/**
 * The action the judge refused.
 *
 * It is destructive on purpose: the approval of the human must not run it,
 * and the harness must not treat the approval as a permission to run it
 * without asking the permission layer again.
 */
const REFUSED_ACTION = "rm -rf /srv/important";

/** The captured requests of the network. */
const captured = [];
const originalFetch = globalThis.fetch;

/**
 * The home of the test.
 *
 * The Telegram channel of the notification package asks a third party
 * whether the message holds a credential before it sends it, and the key
 * of that service is read from the home of the machine. A test that leaves
 * the home alone sends the message of the test to that service, so the
 * home points at an empty directory and the key is not found.
 */
const home = mkdtempSync(join(tmpdir(), "jev-approval-"));
const originalHome = process.env.HOME;
const originalKey = process.env.TYPESAFE_API_KEY;

beforeEach(() => {
	captured.length = 0;
	process.env.HOME = home;
	process.env.TYPESAFE_API_KEY = "";
	globalThis.fetch = (async (input, init) => {
		const url = typeof input === "string" ? input : (input?.url ?? "");
		let body = {};
		try {
			body = JSON.parse(init?.body ?? "{}");
		} catch {
			body = {};
		}
		captured.push({ url, body });
		return new Response(JSON.stringify({ ok: true, result: {} }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
	else process.env.TYPESAFE_API_KEY = originalKey;
});

after(() => {
	rmSync(home, { recursive: true, force: true });
});

/**
 * A center with a Telegram and a LINE channel.
 */
function createCenter() {
	return new NotificationCenter({
		channels: [
			{
				id: "telegram",
				type: "telegram",
				enabled: true,
				config: {
					botToken: "test-bot-token",
					chatId: "12345",
					enableInlineKeyboard: true,
				},
			},
			{
				id: "line",
				type: "line",
				enabled: true,
				config: { channelAccessToken: "test-line-token", userId: "U-test" },
			},
		],
	});
}

/**
 * A todo provider with one item that the test controls.
 *
 * The provider is the only thing that says whether the work is finished:
 * the controller reads it before it closes an item, and an approval of the
 * human is not a close.
 */
function fakeProvider(items) {
	return {
		availability: async () => ({ available: true, provider: "fake" }),
		getSnapshot: async () => ({
			items: items.map((item) => ({ ...item })),
			sessionId: "session-approval",
			revision: 1,
			createdAt: new Date(),
		}),
		getByStatus: async (status) =>
			items.filter((item) => item.status === status),
		getInProgress: async () =>
			items.filter((item) => item.status === "in_progress"),
		getPending: async () =>
			items.filter((item) => item.status === "pending"),
		getCompleted: async () =>
			items.filter((item) => item.status === "completed"),
		getReady: async () =>
			items.filter((item) => item.status === "pending"),
		getBlocked: async () => [],
		getHistory: async () => [],
	};
}

/**
 * The whole chain: the real controller, the real center, the real
 * escalation and the real continuation controller.
 *
 * The dispatch spy records every message the continuation controller sends
 * to the agent. Nothing else is mocked.
 */
function makeChain() {
	const items = [
		{
			id: 1,
			subject: "Remove the old release directory",
			status: "in_progress",
		},
	];
	const provider = fakeProvider(items);
	const dispatched = [];
	const continuation = new TodoContinuationController(
		{
			sessionManager: {
				getSessionId: () => "session-approval",
				getBranch: () => [],
			},
			isIdle: () => true,
			hasPendingMessages: () => false,
		},
		{
			dispatch: async (content) => {
				dispatched.push(content);
			},
			todoProvider: provider,
		},
	);

	const controller = createPendingQuestionController();
	const center = createCenter();
	const runtime = new JevRejectionEscalationRuntime({
		registerQuestion: (context, text) => {
			const question = controller.createQuestion({
				text,
				sessionId: context.sessionId,
				workspacePath: context.workspace,
				jobId: context.originalRequestId,
				kind: "approval",
				askType: "approval",
				contextText: text,
				relevance: "final-request",
				risk: {
					requiresExplicitAuthorization: true,
					destructive: false,
					reversible: true,
					external: false,
				},
			});
			return question.requestId;
		},
		deliver: async (questionId, text) => {
			const results = await center.notifyWithApproval(
				"JevRejectedAction",
				{
					jobId: questionId,
					questionId,
					questionKind: "approval",
					requirement: text,
				},
				{ approveLabel: "Yes", rejectLabel: "No" },
			);
			return results.map((result) => ({
				success: result.success,
				channel: result.channel,
				error: result.error,
			}));
		},
		onApproved: (state) => {
			// The wiring of the harness: the pause of the refusal is over,
			// and one guarded continuation carries the approval to the
			// agent. A pause that belongs to somebody else stays.
			const decision = decideApprovalResume(
				state.context,
				continuation.pauseState(),
			);
			if (decision.resume) {
				continuation.resume();
			}
			void continuation.dispatchAdvisory(
				buildJevApprovalContinuation(state.context, state.questionId),
				{ meta: { reason: "human-approval" } },
			);
		},
		onRejected: () => continuation.explicitPause(),
	});
	return { items, provider, dispatched, continuation, controller, runtime };
}

/**
 * Let the guarded dispatch of the continuation settle.
 *
 * The dispatch is asynchronous: the approval answers the question in the
 * same tick, and the message reaches the agent in the next ones.
 */
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The context of a refusal: the judge refused an operation and the work
 * is paused.
 *
 * The refusal remembers the epoch of the pause it set, so the approval can
 * tell its own pause apart from a pause that came later.
 */
function refusal(chain) {
	chain.continuation.explicitPause();
	return {
		originalRequestId: "req-approval-1",
		sessionId: "session-approval",
		generation: 1,
		workspace: "/srv/work",
		task: "Remove the old release directory",
		action: REFUSED_ACTION,
		reason: "the action is destructive and the request does not name it",
		blocked: ["the removal of the release directory"],
		independentWork: "the report of the remaining disk usage",
		pauseEpoch: chain.continuation.pauseEpoch(),
	};
}

/**
 * The source of the extension.
 *
 * The approval of the human is wired in index.ts, and the tests above
 * drive the parts. The wiring itself is checked here: a change that
 * resumes the work without asking who owns the pause would leave the
 * tests above green.
 */
const indexSource = readFileSync(
	new URL("../index.ts", import.meta.url),
	"utf8",
);

test("the approval of the human asks who owns the pause", () => {
	// The approval is routed through the decision of the ownership: it may
	// only clear the pause of the refusal.
	assert.match(
		indexSource,
		/decideApprovalResume\(\s*state\.context,\s*pause,?\s*\)/,
		"the approval of the human is decided by the ownership of the pause",
	);
	// The pause is read as one state: a temporary pause of the user is a
	// pause too.
	assert.match(
		indexSource,
		/pauseState\?\.\(\)/,
		"the pause of the work is read as one state",
	);
	// The refusal remembers the epoch of the pause it set.
	assert.match(
		indexSource,
		/pauseEpoch: refusalPauseEpoch,/,
		"the refusal remembers the epoch of its pause",
	);
});

test("the approval of the human resumes the work only through the decision", () => {
	// The resume of the work is guarded by the decision: an approval that
	// may not clear the pause does not resume.
	assert.match(
		indexSource,
		/if \(!decision\.resume\) \{[\s\S]{0,600}?\} else \{[\s\S]{0,600}?controller\?\.resume\?\.\(\);/,
		"the work resumes only when the decision allows it",
	);
});

test("the action the judge refused is asked of the human", () => {
	assert.match(
		indexSource,
		/await escalateJevRejection\(\{/,
		"the refusal of the judge is escalated",
	);
});

test("the approval of the human resumes the work and queues one guarded continuation", async () => {
	const chain = makeChain();
	// The judge refused: the work is paused until the human answers.
	const context = refusal(chain);
	assert.equal(chain.continuation.isExplicitlyPaused(), true);

	const result = await chain.runtime.escalate(context);
	assert.equal(result.deliveredAtLeastOne, true);

	const answered = chain.runtime.answer(result.state.questionId, "yes");
	assert.equal(answered, true);
	await settle();

	// The work may continue.
	assert.equal(chain.continuation.isExplicitlyPaused(), false);
	// The approval reaches the agent exactly once, and it carries the
	// scope of the approval.
	assert.equal(chain.dispatched.length, 1);
	assert.ok(
		chain.dispatched[0].includes(REFUSED_ACTION),
		"the continuation does not name the approved action",
	);
	assert.ok(
		chain.dispatched[0].includes("the validation and the safety checks still run"),
		"the continuation does not say that the checks still run",
	);
});

test("the approval of the human does not run the refused action", async () => {
	const chain = makeChain();
	const result = await chain.runtime.escalate(refusal(chain));

	// The human is told what is at stake: the action is named.
	const message = captured
		.map((request) => JSON.stringify(request.body))
		.join("\n");
	assert.ok(
		message.includes(REFUSED_ACTION),
		"the message does not name the action the judge refused",
	);

	// The notifications went out. The approval itself calls nothing: it
	// does not reach an API that would run the action.
	const before = captured.length;
	assert.ok(before > 0, "the message did not reach a channel");

	chain.runtime.answer(result.state.questionId, "yes");
	await settle();

	assert.equal(
		captured.length,
		before,
		"the approval made a request of its own",
	);
	// The approval sends a continuation to the agent, not an execution of
	// the refused action: the message says that the checks still run.
	assert.equal(chain.dispatched.length, 1);
	assert.ok(
		chain.dispatched[0].includes("the validation and the safety checks still run"),
		"the continuation does not say that the checks still run",
	);
});

test("the approval of the human does not finish the work", async () => {
	const chain = makeChain();
	const result = await chain.runtime.escalate(refusal(chain));
	chain.runtime.answer(result.state.questionId, "yes");

	// The item is still open: the approval is not a close.
	assert.equal(chain.items[0].status, "in_progress");

	// The normal completion path still refuses to close it, because the
	// read of the list says that the work is not finished.
	await chain.continuation.markComplete(chain.items[0].id);
	assert.equal(chain.items[0].status, "in_progress");
	const snapshot = await chain.continuation.getSnapshot();
	assert.equal(
		snapshot.items.find((item) => item.id === chain.items[0].id).status,
		"in_progress",
	);
});

test("the rejection of the human keeps the work blocked", async () => {
	const chain = makeChain();
	const result = await chain.runtime.escalate(refusal(chain));

	const answered = chain.runtime.answer(result.state.questionId, "no");
	assert.equal(answered, true);

	// The work stays blocked, and nothing was sent.
	assert.equal(chain.continuation.isExplicitlyPaused(), true);
	assert.deepEqual(chain.dispatched, []);
});

test("the answer of the human wins over the second answer", async () => {
	const chain = makeChain();
	const result = await chain.runtime.escalate(refusal(chain));

	assert.equal(chain.runtime.answer(result.state.questionId, "yes"), true);
	await settle();
	// A second click does not resume a work that was already resumed.
	assert.equal(chain.runtime.answer(result.state.questionId, "no"), false);
	await settle();
	assert.equal(chain.continuation.isExplicitlyPaused(), false);
	assert.equal(chain.dispatched.length, 1, "the approval was delivered twice");
});

test("a message of the user after the refusal is not cleared by the approval", async () => {
	const chain = makeChain();
	const context = refusal(chain);
	const result = await chain.runtime.escalate(context);

	// The user writes something while the question is open. The work waits
	// for that message, so the pause is a pause of its own - even when the
	// user did not say "stop".
	chain.continuation.tempPause();

	assert.equal(chain.runtime.answer(result.state.questionId, "yes"), true);
	await settle();

	// The work stays paused: the approval releases the action, not the
	// message the user is waiting for.
	assert.equal(chain.continuation.pauseState().paused, true);
	assert.deepEqual(chain.dispatched, []);
});

test("the pause of a new session is not the pause of an old refusal", async () => {
	const chain = makeChain();
	const context = refusal(chain);
	await chain.runtime.escalate(context);

	// A new session, a new controller. The epoch of the process is unique,
	// so the pause of the new session is not the pause of the refusal.
	const next = new TodoContinuationController(
		{
			sessionManager: {
				getSessionId: () => "session-approval-2",
				getBranch: () => [],
			},
			isIdle: () => true,
			hasPendingMessages: () => false,
		},
		{
			dispatch: async () => {},
			todoProvider: fakeProvider([]),
		},
	);
	next.explicitPause();
	assert.notEqual(next.pauseEpoch(), context.pauseEpoch);

	const decision = decideApprovalResume(context, next.pauseState());
	assert.equal(decision.resume, false);
	assert.match(decision.reason, /paused after the refusal/);
});

test("a repeated refusal refreshes the pause the escalation owns", async () => {
	const chain = makeChain();
	const context = refusal(chain);
	const result = await chain.runtime.escalate(context);

	// The judge refuses the same request again. The new refusal owns the
	// new pause, so the approval releases the work.
	chain.continuation.explicitPause();
	const repeated = { ...context, pauseEpoch: chain.continuation.pauseEpoch() };
	const again = await chain.runtime.escalate(repeated);
	assert.equal(again.reused, true);
	assert.equal(again.state.context.pauseEpoch, repeated.pauseEpoch);

	assert.equal(chain.runtime.answer(result.state.questionId, "yes"), true);
	await settle();

	// The work may continue: the pause the escalation owns is the pause of
	// the refusal.
	assert.equal(chain.continuation.isExplicitlyPaused(), false);
});

test("a pause that came after the refusal is not cleared by the approval", async () => {
	const chain = makeChain();
	const result = await chain.runtime.escalate(refusal(chain));

	// The user stops the work while the question is open.
	chain.continuation.explicitPause();

	assert.equal(chain.runtime.answer(result.state.questionId, "yes"), true);
	await settle();

	// The work stays paused: the approval releases the action, not a pause
	// that belongs to somebody else.
	assert.equal(chain.continuation.isExplicitlyPaused(), true);
	// And nothing was handed to the agent: the guarded dispatch refuses a
	// paused work.
	assert.deepEqual(chain.dispatched, []);
});

test("a pause that was there before the refusal is not cleared either", async () => {
	const chain = makeChain();
	// The user had already stopped the work before the judge refused.
	chain.continuation.explicitPause();
	const context = {
		originalRequestId: "req-approval-2",
		sessionId: "session-approval",
		generation: 1,
		workspace: "/srv/work",
		task: "Remove the old release directory",
		action: REFUSED_ACTION,
		reason: "the action is destructive and the request does not name it",
		blocked: ["the removal of the release directory"],
		independentWork: "the report of the remaining disk usage",
		pausedBefore: true,
		pauseEpoch: chain.continuation.pauseEpoch(),
	};
	const result = await chain.runtime.escalate(context);

	assert.equal(chain.runtime.answer(result.state.questionId, "yes"), true);
	await settle();

	assert.equal(chain.continuation.isExplicitlyPaused(), true);
	assert.deepEqual(chain.dispatched, []);
});
