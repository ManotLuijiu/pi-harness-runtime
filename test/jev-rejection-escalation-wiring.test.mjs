/**
 * The escalation of a refusal of the judge, end to end.
 *
 * The path that is exercised here is the real one: the judge refuses, the
 * escalation registers a question with a fresh id, the message goes to
 * Telegram and LINE with the buttons [Yes] and [No], and a click resolves
 * exactly that question once.
 *
 * The network is captured instead of the adapter: a mocked adapter would
 * leak into every test file that is loaded after this one.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
	NotificationCenter,
	createPendingQuestionController,
} from "../packages/notification/dist/index.js";
import {
	JevRejectionEscalationRuntime,
} from "../harness/jev-rejection-escalation.ts";

/** The captured requests of the network. */
const captured = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
	captured.length = 0;
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
 * The escalation, wired to the real controller and the real center.
 */
function makeEscalation() {
	const controller = createPendingQuestionController();
	const center = createCenter();
	const approved = [];
	const rejected = [];
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
		onApproved: (state) => approved.push(state),
		onRejected: (state) => rejected.push(state),
	});
	return { runtime, controller, center, approved, rejected };
}

/** The context of a refusal. */
function context() {
	return {
		originalRequestId: "q-179494",
		sessionId: "session-1",
		generation: 3,
		workspace: "/home/frappe/project",
		task: "two commits and their push",
		action: "create and push the two described commits",
		reason: "push is premature because required tests are pending",
		blocked: ["push of the two commits"],
		independentWork: "the pending tests may continue",
	};
}

test("the refusal of the judge reaches the human with working buttons", async () => {
	captured.length = 0;
	const { runtime, controller } = makeEscalation();
	const result = await runtime.escalate(context());

	assert.equal(result.deliveredAtLeastOne, true);
	assert.notEqual(result.state.questionId, "q-179494");

	// The question of the escalation is pending and answers the click.
	const question = controller.getQuestion(result.state.questionId);
	assert.ok(question);
	assert.equal(question.state, "pending");

	// Telegram carries the buttons with the id of the escalation.
	const telegram = captured.find((request) =>
		request.url.includes("api.telegram.org"),
	);
	assert.ok(telegram, "the message did not reach Telegram");
	const keyboard = telegram.body.reply_markup?.inline_keyboard ?? [];
	const callbacks = keyboard.flat().map((button) => button.callback_data);
	assert.equal(callbacks.length, 2);
	for (const callback of callbacks) {
		assert.ok(callback.endsWith(result.state.questionId));
	}
});

test("a click of the human resolves the escalation once", async () => {
	captured.length = 0;
	const { runtime, controller, approved, rejected } = makeEscalation();
	const result = await runtime.escalate(context());
	const questionId = result.state.questionId;

	const applied = controller.applyApproval("approve", questionId, "telegram", {
		notifyUser: false,
	});
	assert.equal(applied.applied, true);
	assert.equal(runtime.answer(questionId, "yes"), true);
	assert.equal(approved.length, 1);
	assert.equal(rejected.length, 0);

	// A second click of another channel does nothing.
	const again = controller.applyApproval("reject", questionId, "line", {
		notifyUser: false,
	});
	assert.equal(again.applied, false);
	assert.equal(runtime.answer(questionId, "no"), false);
	assert.equal(approved.length, 1);
	assert.equal(rejected.length, 0);
});

test("a human rejection leaves the action blocked", async () => {
	captured.length = 0;
	const { runtime, controller, approved, rejected } = makeEscalation();
	const result = await runtime.escalate(context());
	const questionId = result.state.questionId;

	const applied = controller.applyApproval("reject", questionId, "line", {
		notifyUser: false,
	});
	assert.equal(applied.applied, true);
	assert.equal(runtime.answer(questionId, "no"), true);
	assert.equal(rejected.length, 1);
	assert.equal(approved.length, 0);
});
