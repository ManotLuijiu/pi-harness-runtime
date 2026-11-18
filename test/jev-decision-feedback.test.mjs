import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jevDecisionStatus, notifyJevHumanRequired } from "../harness/jev-decision-feedback.ts";
import { WaitLifecycleController } from "../packages/jev-judge/dist/wait-lifecycle.js";
import { NotificationCenter, TelegramAdapter, LineAdapter, createPendingQuestionController } from "../packages/notification/dist/index.js";

const waiting = { outcome: "wait", reasoning: "The deployment needs explicit approval." };
const question = { requestId: "q-feedback", text: "Continue with the deployment?", kind: "approval" };

test("the status distinguishes yes, caution, no, human approval and provider errors", () => {
	for (const [outcome, label] of [
		["approve", "[RUN] Jev: YES - continuing"],
		["proceed_with_caution", "[RUN] Jev: YES - continuing with caution"],
		["reject", "[STOP] Jev: NO - paused"],
		["wait", "[WAIT] Jev: waiting for your approval"],
	]) assert.equal(jevDecisionStatus({ outcome, reasoning: "reason" }), `${label} | reason`);
	assert.equal(jevDecisionStatus({ ...waiting, error: { kind: "provider", message: "unavailable" } }), "[WARN] Jev: evaluation failed | unavailable");
});

test("the status keeps the reason on one bounded terminal line", () => {
	const result = jevDecisionStatus({ ...waiting, reasoning: "\x1b[31mReason\n\t" + "x".repeat(500) });
	assert.ok(result.includes("Reason "));
	assert.doesNotMatch(result, /[\x00-\x1f\x7f]/);
	assert.ok(result.length <= 230);
});

test("the deadline sends one follow-up to both channels with live canonical buttons", async () => {
	const captured = [];
	// The prototype methods are replaced by hand: the mock of `node:test`
	// has no `method` under every runtime of the suite, and this test is
	// about the notification, not about the mock.
	const telegramSend = TelegramAdapter.prototype.send;
	const lineSend = LineAdapter.prototype.send;
	TelegramAdapter.prototype.send = async (payload) => {
		captured.push({ channel: "telegram", payload });
		return { success: true, channel: "telegram" };
	};
	LineAdapter.prototype.send = async (payload) => {
		captured.push({ channel: "line", payload });
		return { success: true, channel: "line" };
	};
	try {
		const center = new NotificationCenter({ channels: [
			{ id: "telegram", type: "telegram", enabled: true, config: { botToken: "test-token", chatId: "12345" } },
			{ id: "line", type: "line", enabled: true, config: { channelAccessToken: "test-token", userId: "U-test" } },
		] });
		const questions = createPendingQuestionController();
		const pending = questions.createQuestion({ text: question.text, sessionId: "s", workspacePath: "/tmp", kind: "approval" });
		let now = 0;
		let status = "countdown";
		const lifecycle = new WaitLifecycleController({
			waitMinutes: 5, now: () => now, currentSessionId: () => "s",
			countdown: { active: true, start() {}, stop() { status = ""; } },
			evaluate: async () => waiting,
		});
		lifecycle.begin({ requestId: pending.requestId, sessionId: "s", text: pending.questionText });
		now = 300_000;
		const result = await lifecycle.evaluateDue();
		assert.equal(result.applied, true);
		assert.equal(result.state, "human_required");
		lifecycle.cancel(); // Runtime clears countdown before displaying the decision.
		status = jevDecisionStatus(result.evaluation);
		await notifyJevHumanRequired({
			question: { ...question, requestId: pending.requestId }, evaluation: result.evaluation,
			isCurrent: () => questions.hasPendingQuestion(),
			deliver: (q, text) => center.notifyWithApproval("WaitingForUserInput", {
				jobId: q.requestId, questionId: q.requestId, questionKind: q.kind, requirement: text,
			}, { approveLabel: "Continue", rejectLabel: "Not yet" }),
			onFailure: (message) => assert.fail(message),
		});
		assert.match(status, /Jev: waiting for your approval/);
		assert.equal((await lifecycle.evaluateDue()).applied, false);
		assert.deepEqual(captured.map((item) => item.channel), ["telegram", "line"]);
		for (const { payload } of captured) {
			assert.match(payload.message, /Jev: waiting for your approval/);
			assert.match(payload.message, /deployment/);
			const buttons = payload.details._actionButtons;
			assert.equal(buttons.length, 2);
			for (const button of buttons) assert.ok(button.callbackData.endsWith(pending.requestId));
		}
		assert.equal(questions.hasPendingQuestion(), true);
		assert.equal(questions.applyApproval("approve", pending.requestId, "telegram", { notifyUser: false }).applied, true);
		assert.equal(questions.applyApproval("approve", pending.requestId, "line", { notifyUser: false }).applied, false);
	} finally {
		TelegramAdapter.prototype.send = telegramSend;
		LineAdapter.prototype.send = lineSend;
	}
});

test("missing, failed and partially failed channels are reported", async () => {
	for (const results of [[], [{ success: false, channel: "telegram" }], [{ success: true, channel: "telegram" }, { success: false, channel: "line" }]]) {
		const failures = [];
		await notifyJevHumanRequired({ question, evaluation: waiting, isCurrent: () => true,
			deliver: async () => results, onFailure: (message) => failures.push(message) });
		assert.equal(failures.length, 1);
	}
});

test("a thrown notification is reported without losing the human-required decision", async () => {
	const failures = [];
	await notifyJevHumanRequired({ question, evaluation: waiting, isCurrent: () => true,
		deliver: async () => { throw new Error("network"); }, onFailure: (message) => failures.push(message) });
	assert.equal(failures.length, 1);
});

test("stale decisions, provider failures and non-wait outcomes send no approval reminder", async () => {
	for (const [evaluation, current] of [[waiting, false], [{ ...waiting, outcome: "approve" }, true], [{ ...waiting, outcome: "reject" }, true], [{ ...waiting, error: { kind: "provider", message: "offline" } }, true]]) {
		await notifyJevHumanRequired({ question, evaluation, isCurrent: () => current,
			deliver: async () => assert.fail("must not notify"), onFailure: () => assert.fail("must not overwrite status") });
	}
});

test("a late failure cannot replace a newer question's status", async () => {
	let current = true;
	await notifyJevHumanRequired({ question, evaluation: waiting, isCurrent: () => current,
		deliver: async () => { current = false; return []; }, onFailure: () => assert.fail("stale failure") });
});

test("choice alternatives are included in the follow-up", async () => {
	await notifyJevHumanRequired({ question: { ...question, kind: "choice", alternatives: ["A", "B"] }, evaluation: waiting,
		isCurrent: () => true, deliver: async (_q, text) => {
			assert.match(text, /1\. A\n2\. B/);
			return [{ success: true, channel: "telegram" }];
		}, onFailure: (message) => assert.fail(message) });
});

test("runtime preserves decisions after countdown cleanup and wires the follow-up", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const waitAt = source.indexOf('if (outcome === "wait") {', source.indexOf("const applyWaitDecision"));
	const branch = source.slice(waitAt, source.indexOf("// Close the question", waitAt));
	assert.match(branch, /clearWait\(\);\s*showJevDecision\(evaluation\);/);
	assert.match(branch, /notifyJevHumanRequired/);
	assert.match(branch, /questionId: question\.requestId/);
	assert.doesNotMatch(branch, /updateAutoContinueStatus\("IDLE"\)/);
	assert.match(source, /showJevDecision\(result\.evaluation\)/);
});
