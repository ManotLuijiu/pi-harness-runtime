/**
 * The notification of the choice of the recipient of a plan.
 *
 * Several Pi instances can run in the workspace of a plan. The plan is not
 * broadcast: the user chooses the instance that receives it. The message
 * therefore travels in full, the candidates are named by their identity and
 * not by their model, and the action of the buttons is a single token,
 * because the callback data is split on the underscore.
 *
 * The network is captured instead of the adapter: a mocked adapter would
 * leak into every test file that is loaded after this one.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { NotificationCenter } from "../src/notification-center.js";
import { isHighPriority, requiresApproval } from "../src/notification-policy.js";
import { telegramStatusLabel } from "../src/adapters/telegram-adapter.js";
import { CallbackActions, parseCallbackData } from "../src/telegram-webhook-handler.js";
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
	"Several Pi instances run in /home/user/project.",
	"The plan is not broadcast: choose the instance that receives it.",
	"",
	"1. agent-12345678 / session session-a (minimax)",
	"2. agent-87654321 / session session-b (minimax)",
].join("\n");

const BUTTONS = [
	{ text: "1. agent-1234", action: "planpick", targetId: "aaaabbbbcccc" },
	{ text: "2. agent-8765", action: "planpick", targetId: "ddddeeeeffff" },
];

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

describe("the choice of the recipient of a plan", () => {
	it("is a question that the policy may not drop", () => {
		expect(requiresApproval("PlanRecipientSelection")).toBe(false);
		expect(isHighPriority("PlanRecipientSelection")).toBe(true);
		expect(telegramStatusLabel("PlanRecipientSelection")).toBe("[PICK]");
	});

	it("uses a single token as the action of the buttons", () => {
		expect(CallbackActions.PLAN_RECIPIENT).toBe("planpick");
		expect(CallbackActions.PLAN_RECIPIENT).not.toContain("_");
	});

	it("carries the whole message on Telegram", async () => {
		const center = createCenter();
		await center.notifyWithButtons(
			"PlanRecipientSelection",
			{ jobId: "plan-handoff", requirement: MESSAGE },
			BUTTONS,
		);

		const telegram = requestsOf("api.telegram.org")[0];
		expect(telegram).toBeDefined();
		const text = JSON.stringify(telegram.body);
		expect(text).toContain("agent-12345678");
		expect(text).toContain("session-b");
		expect(text).not.toContain("...");
	});

	it("offers one button per candidate, each with a single token", async () => {
		const center = createCenter();
		await center.notifyWithButtons(
			"PlanRecipientSelection",
			{ jobId: "plan-handoff", requirement: MESSAGE },
			BUTTONS,
		);

		const telegram = requestsOf("api.telegram.org")[0];
		const keyboard = telegram.body.reply_markup?.inline_keyboard ?? [];
		const callbacks = keyboard.flat().map((button: any) => button.callback_data);
		expect(callbacks).toEqual([
			"planpick_aaaabbbbcccc",
			"planpick_ddddeeeeffff",
		]);
		for (const callback of callbacks) {
			expect(callback.split("_")).toHaveLength(2);
		}
	});

	it("names the token of the candidate when the callback is parsed", async () => {
		const center = createCenter();
		await center.notifyWithButtons(
			"PlanRecipientSelection",
			{ jobId: "plan-handoff", requirement: MESSAGE },
			BUTTONS,
		);

		const telegram = requestsOf("api.telegram.org")[0];
		const keyboard = telegram.body.reply_markup?.inline_keyboard ?? [];
		const callback = keyboard.flat()[1].callback_data as string;
		const parsed = parseCallbackData(callback);
		expect(parsed.action).toBe("planpick");
		expect(parsed.targetId).toBe("ddddeeeeffff");
	});

	it("carries the whole message on LINE with the actions", async () => {
		const center = createCenter();
		await center.notifyWithButtons(
			"PlanRecipientSelection",
			{ jobId: "plan-handoff", requirement: MESSAGE },
			BUTTONS,
		);

		const line = requestsOf("api.line.me")[0];
		expect(line).toBeDefined();
		const text = JSON.stringify(line.body);
		expect(text).toContain("agent-12345678");
		expect(text).toContain("planpick_aaaabbbbcccc");
	});
});
