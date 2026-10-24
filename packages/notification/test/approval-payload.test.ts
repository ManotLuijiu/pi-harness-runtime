/**
 * Approval payload tests.
 *
 * The question has to reach the user complete, and the Yes/No actions have
 * to point at the canonical request ID - on Telegram and on LINE. A button
 * that carries a prefixed job ID can never match the pending question, so
 * every click is reported as stale and the approval is lost.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { NotificationCenter } from "../src/notification-center.js";
import { PendingQuestionController } from "../src/pending-question.js";
import { parseCallbackData } from "../src/telegram-webhook-handler.js";
import type { NotificationConfig } from "../src/types.js";

const LONG_QUESTION =
	"Want me to implement the persistence layer with the SQLite schema, the migration runner and the rollback path, and then wire it into the harness? ";

interface CapturedRequest {
	url: string;
	body: Record<string, any>;
}

let captured: CapturedRequest[] = [];
let originalFetch: typeof globalThis.fetch;

function createCenter(): NotificationCenter {
	const config: NotificationConfig = {
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
	};
	return new NotificationCenter(config);
}

function telegramRequests(): CapturedRequest[] {
	return captured.filter((r) => r.url.includes("api.telegram.org"));
}

function lineRequests(): CapturedRequest[] {
	return captured.filter((r) => r.url.includes("api.line.me"));
}

beforeEach(() => {
	captured = [];
	originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: any, init?: any) => {
		const url = typeof input === "string" ? input : (input?.url ?? "");
		let body: any = {};
		try {
			body = JSON.parse(init?.body ?? "{}");
		} catch {
			body = {};
		}
		captured.push({ url, body });

		// The content filter asks Jev. Without a configured key the answer
		// does not matter, and a failure keeps the test offline.
		if (url.includes("typesafe.ai")) {
			return new Response("unauthorized", { status: 401 });
		}
		return new Response(JSON.stringify({ ok: true, result: {} }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("approval payload", () => {
	it("sends the complete question to Telegram without truncating it", async () => {
		const center = createCenter();
		const question = LONG_QUESTION.repeat(3);

		await center.notifyWithApproval("WaitingForUserInput", {
			jobId: "q-long",
			questionId: "q-long",
			requirement: question,
		});

		const text = telegramRequests()
			.map((r) => String(r.body.text ?? ""))
			.join("\n");

		expect(text).toContain(question.trim());
		// The shared 50 character summary must not be used for a question.
		expect(text).not.toContain("...");
	});

	it("sends the complete question to LINE", async () => {
		const center = createCenter();
		const question = LONG_QUESTION.repeat(3);

		await center.notifyWithApproval("WaitingForUserInput", {
			jobId: "q-long",
			questionId: "q-long",
			requirement: question,
		});

		const line = lineRequests()[0];
		const messages = line?.body?.messages ?? [];
		const textMessage = messages.find((m: any) => m.type === "text");

		expect(textMessage).toBeDefined();
		expect(String(textMessage.text)).toContain(question.trim());
	});

	it("puts the canonical request ID into the Telegram callback data", async () => {
		const center = createCenter();

		await center.notifyWithApproval("WaitingForUserInput", {
			jobId: "waiting-user-q-123",
			questionId: "q-123",
			requirement: "Want me to continue?",
		});

		const telegram = telegramRequests()[0];
		const keyboard = telegram?.body?.reply_markup;
		expect(keyboard).toBeDefined();

		const approve = keyboard.inline_keyboard[0][0];
		const reject = keyboard.inline_keyboard[0][1];

		const parsedApprove = parseCallbackData(approve.callback_data);
		const parsedReject = parseCallbackData(reject.callback_data);

		expect(parsedApprove.action).toBe("approve");
		expect(parsedReject.action).toBe("reject");
		// The canonical ID, not the prefixed presentation job ID.
		expect(parsedApprove.targetId).toBe("q-123");
		expect(parsedReject.targetId).toBe("q-123");
	});

	it("resolves the matching pending question from the real callback data", async () => {
		const center = createCenter();
		const controller = new PendingQuestionController();
		const question = controller.createQuestion({
			text: "Want me to continue?",
			sessionId: "session-1",
			workspacePath: "/tmp",
			kind: "approval",
		});

		await center.notifyWithApproval("WaitingForUserInput", {
			jobId: `waiting-user-${question.requestId}`,
			questionId: question.requestId,
			requirement: "Want me to continue?",
		});

		const telegram = telegramRequests()[0];
		const callbackData = telegram.body.reply_markup.inline_keyboard[0][0]
			.callback_data as string;
		const parsed = parseCallbackData(callbackData);

		const applied = controller.applyApproval(
			parsed.action,
			parsed.targetId,
			"telegram",
		);

		expect(applied.applied).toBe(true);
		expect(applied.resolution).toBe("yes");
		expect(controller.getResolution()).toBe("yes");
		expect(controller.getCurrentQuestion()?.resolvedBy).toBe("user");
		expect(controller.getCurrentQuestion()?.resolvedChannel).toBe("telegram");
	});

	it("uses the same canonical ID for the LINE postback actions", async () => {
		const center = createCenter();

		await center.notifyWithApproval("WaitingForUserInput", {
			jobId: "waiting-user-q-123",
			questionId: "q-123",
			requirement: "Want me to continue?",
		});

		const line = lineRequests()[0];
		const messages = line?.body?.messages ?? [];
		const template = messages.find((m: any) => m.type === "template");
		expect(template).toBeDefined();

		const actions = template.template.actions;
		expect(actions).toHaveLength(2);
		expect(actions[0].type).toBe("postback");
		expect(actions[1].type).toBe("postback");

		const approve = parseCallbackData(actions[0].data);
		const reject = parseCallbackData(actions[1].data);

		expect(approve.action).toBe("approve");
		expect(reject.action).toBe("reject");
		expect(approve.targetId).toBe("q-123");
		expect(reject.targetId).toBe("q-123");
	});

	it("routes the LINE postback into the same resolver as Telegram", async () => {
		const center = createCenter();
		const controller = new PendingQuestionController();
		const question = controller.createQuestion({
			text: "Want me to continue?",
			sessionId: "session-1",
			workspacePath: "/tmp",
			kind: "approval",
		});

		await center.notifyWithApproval("WaitingForUserInput", {
			jobId: `waiting-user-${question.requestId}`,
			questionId: question.requestId,
			requirement: "Want me to continue?",
		});

		const line = lineRequests()[0];
		const messages = line?.body?.messages ?? [];
		const template = messages.find((m: any) => m.type === "template");
		const parsed = parseCallbackData(template.template.actions[0].data);

		const applied = controller.applyApproval(
			parsed.action,
			parsed.targetId,
			"line",
		);

		expect(applied.applied).toBe(true);
		expect(controller.getResolution()).toBe("yes");
		expect(controller.getCurrentQuestion()?.resolvedChannel).toBe("line");
	});

	it("attaches the keyboard only to the final chunk of a long question", async () => {
		const center = createCenter();
		const question = `${LONG_QUESTION.repeat(30)}Want me to continue?`;

		await center.notifyWithApproval("WaitingForUserInput", {
			jobId: "q-chunked",
			questionId: "q-chunked",
			requirement: question,
		});

		const requests = telegramRequests();
		expect(requests.length).toBeGreaterThan(1);

		const withKeyboard = requests.filter((r) => r.body?.reply_markup);
		expect(withKeyboard).toHaveLength(1);
		// The actionable message is the last one.
		expect(withKeyboard[0]).toBe(requests[requests.length - 1]);

		// The question stays understandable across the chunks.
		const allText = requests.map((r) => String(r.body.text ?? "")).join("");
		expect(allText).toContain("Want me to continue?");
		expect(allText).toContain("[Part 1/");
	});
});
