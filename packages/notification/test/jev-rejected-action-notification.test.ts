/**
 * The notification of the refusal of the judge.
 *
 * The human is asked with working [Yes] / [No] buttons. The message names
 * the workspace, the task, the exact action, the reason of the judge and
 * what stays blocked, because a human may only answer what it can see.
 *
 * The network is captured instead of the adapter: a mocked adapter would
 * leak into every test file that is loaded after this one.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { NotificationCenter } from "../src/notification-center.js";
import { isHighPriority, requiresApproval } from "../src/notification-policy.js";
import { telegramStatusLabel } from "../src/adapters/telegram-adapter.js";
import { parseCallbackData } from "../src/telegram-webhook-handler.js";
import type { NotificationConfig } from "../src/types.js";

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

function requestsOf(channel: string): CapturedRequest[] {
	return captured.filter((request) => request.url.includes(channel));
}

const MESSAGE = [
	"Jev recommends No: push is premature because required tests are pending.",
	"Workspace: /home/user/project. Task: two commits and their push.",
	"Proposed action: create and push the two described commits.",
	"The create and push the two described commits stays blocked while you decide; the pending tests may continue.",
	"Do you approve this action? [Yes] [No]",
].join("\n");

const QUESTION_ID = "q-escalation-1";

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
		return new Response(JSON.stringify({ ok: true, result: {} }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("the refusal of the judge", () => {
	it("is a question that the policy may not drop", () => {
		expect(requiresApproval("JevRejectedAction")).toBe(true);
		expect(isHighPriority("JevRejectedAction")).toBe(true);
		expect(telegramStatusLabel("JevRejectedAction")).toBe("[APPROVAL]");
	});

	it("carries the whole message on Telegram", async () => {
		const center = createCenter();
		await center.notifyWithApproval(
			"JevRejectedAction",
			{
				jobId: QUESTION_ID,
				questionId: QUESTION_ID,
				questionKind: "approval",
				requirement: MESSAGE,
			},
			{ approveLabel: "Yes", rejectLabel: "No" },
		);

		const telegram = requestsOf("api.telegram.org")[0];
		expect(telegram).toBeDefined();
		const text = JSON.stringify(telegram.body);
		expect(text).toContain("Jev recommends No");
		expect(text).toContain("Workspace: /home/user/project");
		expect(text).toContain("Proposed action: create and push the two described commits");
		expect(text).toContain("stays blocked");
		expect(text).not.toContain("...");
	});

	it("offers the buttons [Yes] and [No] with the question id", async () => {
		const center = createCenter();
		await center.notifyWithApproval(
			"JevRejectedAction",
			{
				jobId: QUESTION_ID,
				questionId: QUESTION_ID,
				questionKind: "approval",
				requirement: MESSAGE,
			},
			{ approveLabel: "Yes", rejectLabel: "No" },
		);

		const telegram = requestsOf("api.telegram.org")[0];
		const keyboard = telegram.body.reply_markup?.inline_keyboard ?? [];
		const buttons = keyboard.flat();
		expect(buttons).toHaveLength(2);
		expect(buttons[0].text).toContain("Yes");
		expect(buttons[1].text).toContain("No");

		const callbacks = buttons.map((button: any) => button.callback_data as string);
		expect(parseCallbackData(callbacks[0]).targetId).toBe(QUESTION_ID);
		expect(parseCallbackData(callbacks[1]).targetId).toBe(QUESTION_ID);
		expect(parseCallbackData(callbacks[0]).action).toBe("approve");
		expect(parseCallbackData(callbacks[1]).action).toBe("reject");
		// The callback data of Telegram is limited to 64 bytes.
		for (const callback of callbacks) {
			expect(Buffer.byteLength(callback, "utf8")).toBeLessThanOrEqual(64);
		}
	});

	it("carries the whole message on LINE with the actions", async () => {
		const center = createCenter();
		await center.notifyWithApproval(
			"JevRejectedAction",
			{
				jobId: QUESTION_ID,
				questionId: QUESTION_ID,
				questionKind: "approval",
				requirement: MESSAGE,
			},
			{ approveLabel: "Yes", rejectLabel: "No" },
		);

		const line = requestsOf("api.line.me")[0];
		expect(line).toBeDefined();
		const text = JSON.stringify(line.body);
		expect(text).toContain("Proposed action: create and push the two described commits");
		expect(text).toContain("Yes");
		expect(text).toContain("No");
		// LINE allows at most four actions and short labels.
		const actions = line.body.messages?.[0]?.template?.actions ?? [];
		expect(actions.length).toBeLessThanOrEqual(4);
		for (const action of actions) {
			expect((action.label ?? "").length).toBeLessThanOrEqual(20);
		}
	});
});
