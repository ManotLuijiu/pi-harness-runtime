/**
 * The notification of an empty weekly allowance.
 *
 * The message is a decision: it says how long the week still lasts and
 * that the work is paused, and it offers the two choices. The message
 * therefore travels in full - a truncated message is not a message the
 * human can decide about - and the actions of the buttons are single
 * tokens, because the callback data is split on the underscore.
 *
 * The network is captured instead of the adapter: a mocked adapter would
 * leak into every test file that is loaded after this one.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { NotificationCenter } from "../src/notification-center.js";
import { requiresApproval } from "../src/notification-policy.js";
import { telegramStatusLabel } from "../src/adapters/telegram-adapter.js";
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

const MESSAGE =
	"MiniMax weekly quota exhausted. Resets in 2 days 7 hours 58 minutes. Work is paused.";

const BUTTONS = [
	{ text: "Count down week resets", action: "weekcountdown", targetId: "week-minimax-1a2b3c4d" },
	{ text: "I will handle it", action: "weekmanual", targetId: "week-minimax-1a2b3c4d" },
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

describe("the empty weekly allowance", () => {
	it("needs no approval and has a status label of its own", () => {
		expect(requiresApproval("QuotaWeeklyExhausted")).toBe(false);
		expect(telegramStatusLabel("QuotaWeeklyExhausted")).toBe("[WEEK]");
	});

	it("carries the whole message on Telegram", async () => {
		const center = createCenter();
		await center.notifyWithButtons(
			"QuotaWeeklyExhausted",
			{
				jobId: "week-minimax-1a2b3c4d",
				questionId: "week-minimax-1a2b3c4d",
				requirement: MESSAGE,
			},
			BUTTONS,
		);

		const telegram = requestsOf("api.telegram.org")[0];
		expect(telegram).toBeDefined();
		const text = JSON.stringify(telegram.body);
		expect(text).toContain(MESSAGE);
		expect(text).not.toContain("...");
	});

	it("offers the two choices with a single token each", async () => {
		const center = createCenter();
		await center.notifyWithButtons(
			"QuotaWeeklyExhausted",
			{
				jobId: "week-minimax-1a2b3c4d",
				questionId: "week-minimax-1a2b3c4d",
				requirement: MESSAGE,
			},
			BUTTONS,
		);

		const telegram = requestsOf("api.telegram.org")[0];
		const keyboard = telegram.body.reply_markup?.inline_keyboard ?? [];
		const callbacks = keyboard.flat().map((button: any) => button.callback_data);
		expect(callbacks).toEqual([
			"weekcountdown_week-minimax-1a2b3c4d",
			"weekmanual_week-minimax-1a2b3c4d",
		]);
		for (const callback of callbacks) {
			expect(callback.split("_")).toHaveLength(2);
		}
	});

	it("carries the whole message on LINE with the two actions", async () => {
		const center = createCenter();
		await center.notifyWithButtons(
			"QuotaWeeklyExhausted",
			{
				jobId: "week-minimax-1a2b3c4d",
				questionId: "week-minimax-1a2b3c4d",
				requirement: MESSAGE,
			},
			BUTTONS,
		);

		const line = requestsOf("api.line.me")[0];
		expect(line).toBeDefined();
		const messages = line.body.messages ?? [];
		const text = messages
			.filter((message: any) => message.type === "text")
			.map((message: any) => message.text)
			.join("\n");
		expect(text).toContain(MESSAGE);

		const template = messages.find((message: any) => message.type === "template");
		expect(template).toBeDefined();
		const actions = template.template.actions;
		expect(actions).toHaveLength(2);
		expect(actions[0].data).toBe("weekcountdown_week-minimax-1a2b3c4d");
		expect(actions[1].data).toBe("weekmanual_week-minimax-1a2b3c4d");
		for (const action of actions) {
			expect(action.label.length).toBeLessThanOrEqual(20);
			expect(action.data.length).toBeLessThanOrEqual(100);
		}
	});
});
