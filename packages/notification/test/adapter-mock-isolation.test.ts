/**
 * The isolation of the adapter mocks.
 *
 * Bun keeps one module registry for the whole test run. A mock that a test
 * file registers is therefore still in place for every file that runs after
 * it, and a file that expects the real adapter receives the mock instead.
 *
 * `notification.test.ts` mocks the adapters on purpose, so it restores them
 * when it is done. This file proves that the restore works: it runs after
 * `notification.test.ts` and expects the real implementations.
 *
 * The order of the files is the order Bun discovers them in, and the test
 * names in this file are numbered so the dependency on that order is
 * visible instead of accidental.
 */

import { describe, it, expect } from "bun:test";
import { NotificationCenter } from "../src/notification-center.js";
import {
	TelegramAdapter,
	buildTelegramMessage,
	telegramStatusLabel,
} from "../src/adapters/telegram-adapter.js";
import { LineAdapter } from "../src/adapters/line-adapter.js";
import { NtfyAdapter } from "../src/adapters/ntfy-adapter.js";
import { EmailAdapter } from "../src/adapters/email-adapter.js";
import { WebhookAdapter } from "../src/adapters/webhook-adapter.js";

describe("the real adapters are in place", () => {
	it("1 keeps the telegram adapter real", () => {
		expect(typeof TelegramAdapter).toBe("function");
		expect(TelegramAdapter.prototype.isConfigured).toBeDefined();
		expect(TelegramAdapter.prototype.send).toBeDefined();
	});

	it("2 keeps the other adapters real", () => {
		expect(typeof LineAdapter).toBe("function");
		expect(typeof NtfyAdapter).toBe("function");
		expect(typeof EmailAdapter).toBe("function");
		expect(typeof WebhookAdapter).toBe("function");
	});

	it("3 keeps the helpers of the telegram adapter real", () => {
		// The mock of notification.test.ts replaces the whole module, so a
		// helper that the mock does not carry would be missing here.
		expect(typeof buildTelegramMessage).toBe("function");
		expect(typeof telegramStatusLabel).toBe("function");
	});

	it("4 builds a real adapter through the center", () => {
		const center = new NotificationCenter();
		const registered = center.registerAdapter({
			id: "telegram-real",
			type: "telegram",
			enabled: true,
			config: { botToken: "token", chatId: "chat" },
		});
		expect(registered).toBe(true);
		expect(center.listChannels()).toContain("telegram-real");
	});
});
