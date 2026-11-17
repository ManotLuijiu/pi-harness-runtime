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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	NotificationCenter,
	createPendingQuestionController,
} from "../packages/notification/dist/index.js";
import { TodoContinuationController } from "../packages/jev-judge/dist/index.js";
import { JevRejectionEscalationRuntime } from "../harness/jev-rejection-escalation.ts";

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
		onApproved: () => continuation.resume(),
		onRejected: () => continuation.explicitPause(),
	});
	return { items, provider, dispatched, continuation, controller, runtime };
}

/**
 * The context of a refusal: the judge refused an operation and the work
 * is paused.
 */
function refusal() {
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
	};
}

test("the approval of the human resumes the work and sends nothing", async () => {
	const chain = makeChain();
	// The judge refused: the work is paused until the human answers.
	chain.continuation.explicitPause();
	assert.equal(chain.continuation.isExplicitlyPaused(), true);

	const result = await chain.runtime.escalate(refusal());
	assert.equal(result.deliveredAtLeastOne, true);

	const answered = chain.runtime.answer(result.state.questionId, "yes");
	assert.equal(answered, true);

	// The work may continue.
	assert.equal(chain.continuation.isExplicitlyPaused(), false);
	// The approval is not a dispatch: the continuation of the work is a
	// separate, guarded step.
	assert.deepEqual(chain.dispatched, []);
});

test("the approval of the human does not run the refused action", async () => {
	const chain = makeChain();
	chain.continuation.explicitPause();
	const result = await chain.runtime.escalate(refusal());

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

	assert.equal(
		captured.length,
		before,
		"the approval made a request of its own",
	);
	// The approval sends nothing to the agent, so the action is not run
	// as an execution of the question.
	assert.deepEqual(chain.dispatched, []);
});

test("the approval of the human does not finish the work", async () => {
	const chain = makeChain();
	chain.continuation.explicitPause();
	const result = await chain.runtime.escalate(refusal());
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
	chain.continuation.explicitPause();
	const result = await chain.runtime.escalate(refusal());

	const answered = chain.runtime.answer(result.state.questionId, "no");
	assert.equal(answered, true);

	// The work stays blocked, and nothing was sent.
	assert.equal(chain.continuation.isExplicitlyPaused(), true);
	assert.deepEqual(chain.dispatched, []);
});

test("the answer of the human wins over the second answer", async () => {
	const chain = makeChain();
	chain.continuation.explicitPause();
	const result = await chain.runtime.escalate(refusal());

	assert.equal(chain.runtime.answer(result.state.questionId, "yes"), true);
	// A second click does not resume a work that was already resumed.
	assert.equal(chain.runtime.answer(result.state.questionId, "no"), false);
	assert.equal(chain.continuation.isExplicitlyPaused(), false);
	assert.deepEqual(chain.dispatched, []);
});
