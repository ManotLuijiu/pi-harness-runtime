/**
 * Tooling proposal payload tests.
 *
 * The proposal (Biome.js instead of ESLint/Prettier) is a decision of its
 * own. Its buttons carry the tooling action, never the approval action:
 * a "No" on a proposal must not pause the work, and a "Yes" must not
 * resume a pending question.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { NotificationCenter } from "../src/notification-center.js";
import { parseCallbackData } from "../src/telegram-webhook-handler.js";
import type { NotificationConfig } from "../src/types.js";

const PROPOSAL =
	"This workspace looks like a Next.js + React project that still uses ESLint and Prettier. " +
	"Biome.js can replace both: one tool for linting, formatting and import order.";

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

function lineRequests(): CapturedRequest[] {
	return captured.filter((r) => r.url.includes("api.line.me"));
}

/**
 * Capture the payload the Telegram adapter is asked to send.
 *
 * The adapter is replaced instead of the network, so the test does not
 * depend on which adapter implementation is loaded.
 */
function captureTelegramPayload(center: NotificationCenter): {
	payloads: Array<Record<string, any>>;
} {
	const payloads: Array<Record<string, any>> = [];
	const adapter = center.getTelegramAdapter();
	if (adapter) {
		adapter.send = (async (payload: any) => {
			payloads.push(payload);
			return { success: true, channel: "telegram" };
		}) as typeof adapter.send;
	}
	return { payloads };
}

async function sendProposal(center: NotificationCenter): Promise<void> {
	await center.notifyWithButtons(
		"ToolingPreferenceProposal",
		{
			jobId: "biome-abc123",
			questionId: "biome-abc123",
			requirement: PROPOSAL,
			taskTitle: "Tooling proposal",
		},
		[
			{ text: "Yes - use Biome.js", action: "biome", targetId: "yes-biome-abc123" },
			{ text: "No - keep the current tools", action: "biome", targetId: "no-biome-abc123" },
		],
		{
			additionalDetails: { _actionPrompt: "Use Biome.js in this workspace?" },
		},
	);
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

describe("the tooling proposal payload", () => {
	it("sends the proposal to Telegram with two buttons of the tooling action", async () => {
		const center = createCenter();
		const { payloads } = captureTelegramPayload(center);

		await sendProposal(center);

		const payload = payloads[0];
		expect(payload).toBeDefined();

		const buttons = payload.details._actionButtons as Array<{
			callbackData: string;
		}>;
		expect(buttons).toHaveLength(2);

		const parsedYes = parseCallbackData(buttons[0].callbackData);
		const parsedNo = parseCallbackData(buttons[1].callbackData);

		expect(parsedYes.action).toBe("biome");
		expect(parsedNo.action).toBe("biome");
		expect(parsedYes.targetId).toBe("yes-biome-abc123");
		expect(parsedNo.targetId).toBe("no-biome-abc123");
	});

	it("never uses the approval action for a proposal button", async () => {
		const center = createCenter();
		const { payloads } = captureTelegramPayload(center);

		await sendProposal(center);

		const buttons = payloads[0].details._actionButtons as Array<{
			callbackData: string;
		}>;

		for (const button of buttons) {
			const parsed = parseCallbackData(button.callbackData);
			expect(parsed.action).not.toBe("approve");
			expect(parsed.action).not.toBe("reject");
		}
	});

	it("sends the same buttons to LINE", async () => {
		await sendProposal(createCenter());

		const line = lineRequests()[0];
		const messages = line?.body?.messages ?? [];
		const template = messages.find((m: any) => m.type === "template");
		expect(template).toBeDefined();

		const actions = template.template.actions ?? [];
		expect(actions).toHaveLength(2);
		expect(actions[0].data).toBe("biome_yes-biome-abc123");
		expect(actions[1].data).toBe("biome_no-biome-abc123");
	});

	it("shows the wording of the proposal on LINE", async () => {
		await sendProposal(createCenter());

		const line = lineRequests()[0];
		const messages = line?.body?.messages ?? [];
		const template = messages.find((m: any) => m.type === "template");

		expect(String(template.template.title)).toContain("Biome.js");
		expect(String(template.altText)).toContain("Biome.js");
	});

	it("sends the complete proposal to the user", async () => {
		const center = createCenter();
		const { payloads } = captureTelegramPayload(center);

		await sendProposal(center);

		const payload = payloads[0];
		expect(String(payload.message)).toContain("Biome.js");
		expect(String(payload.message)).toContain("ESLint");
		expect(String(payload.message)).toContain("Prettier");
		expect(String(payload.message)).not.toContain("...");
	});

	it("never sends the proposal to a channel the user turned off", async () => {
		const center = createCenter();
		center.setChannelEnabled("telegram", false);
		const { payloads } = captureTelegramPayload(center);

		await sendProposal(center);

		// The button of a channel that stays silent could never be answered.
		expect(payloads).toHaveLength(0);
		// The other channel still receives the proposal.
		expect(lineRequests().length).toBeGreaterThan(0);
	});
});
