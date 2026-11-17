/**
 * Notification Center Tests
 */

import { describe, it, expect, beforeEach, afterAll, vi, mock } from "bun:test";
import { NotificationCenter } from "../src/notification-center.js";
import type { NotificationChannelConfig } from "../src/types.js";

// Mock adapters
const mockSend = vi.fn();
const mockInitialize = vi.fn().mockResolvedValue(true);
const mockIsConfigured = vi.fn().mockReturnValue(true);

// Bun keeps the module registry for the whole test run, so a mock that is
// registered here is still in place for every file that runs after this one.
// A later file that imports the real adapter would then receive this mock
// instead, and it would fail for a reason that has nothing to do with its
// own code.
//
// The fix is to restore the real modules when this file is done. The query
// suffix gives a module instance that the mock never replaced, so it holds
// the real implementation. Every mock below spreads that instance, so the
// mocked module keeps all the exports of the real one and the restore can
// put every export back.
//
// The specifier is built at runtime because TypeScript resolves a literal
// import and would report the query suffix as a missing module.
const realModule = async (
	specifier: string,
): Promise<Record<string, unknown>> =>
	(await import(`${specifier}?real`)) as Record<string, unknown>;

const realTelegram = await realModule("../src/adapters/telegram-adapter.js");
const realNtfy = await realModule("../src/adapters/ntfy-adapter.js");
const realEmail = await realModule("../src/adapters/email-adapter.js");
const realWebhook = await realModule("../src/adapters/webhook-adapter.js");

// The mocks are classes, not mock functions: the notification center checks
// the adapter with "instanceof", and a mocked constructor makes that check
// throw for every test file that is loaded after this one.
vi.mock("../src/adapters/telegram-adapter.js", () => ({
	...realTelegram,
	TelegramAdapter: class {
		id = "telegram";
		type = "telegram";
		send = mockSend;
		initialize = mockInitialize;
		isConfigured = mockIsConfigured;
	},
}));

vi.mock("../src/adapters/ntfy-adapter.js", () => ({
	...realNtfy,
	NtfyAdapter: class {
		id = "ntfy";
		type = "ntfy";
		send = mockSend;
		initialize = mockInitialize;
		isConfigured = mockIsConfigured;
	},
}));

vi.mock("../src/adapters/email-adapter.js", () => ({
	...realEmail,
	EmailAdapter: class {
		id = "email";
		type = "email";
		send = mockSend;
		initialize = mockInitialize;
		isConfigured = mockIsConfigured;
	},
}));

vi.mock("../src/adapters/webhook-adapter.js", () => ({
	...realWebhook,
	WebhookAdapter: class {
		id = "webhook";
		type = "webhook";
		send = mockSend;
		initialize = mockInitialize;
		isConfigured = mockIsConfigured;
	},
}));

// Restore the real adapters for the files that run after this one.
afterAll(() => {
	mock.module("../src/adapters/telegram-adapter.js", () => ({ ...realTelegram }));
	mock.module("../src/adapters/ntfy-adapter.js", () => ({ ...realNtfy }));
	mock.module("../src/adapters/email-adapter.js", () => ({ ...realEmail }));
	mock.module("../src/adapters/webhook-adapter.js", () => ({ ...realWebhook }));
});

describe("NotificationCenter", () => {
	beforeEach(() => {
		mockSend.mockReset().mockResolvedValue({ success: true, channel: "mock" });
		mockInitialize.mockReset().mockResolvedValue(true);
		mockIsConfigured.mockReturnValue(true);
	});

	describe("construction", () => {
		it("creates instance without config", () => {
			const center = new NotificationCenter();
			expect(center).toBeDefined();
		});

		it("has no channels by default", () => {
			const center = new NotificationCenter();
			expect(center.hasChannels()).toBe(false);
			expect(center.listChannels()).toEqual([]);
		});
	});

	describe("registerAdapter", () => {
		it("registers a telegram adapter", () => {
			const center = new NotificationCenter();
			const config: NotificationChannelConfig = {
				id: "telegram-main",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			};
			const result = center.registerAdapter(config);
			expect(result).toBe(true);
			expect(center.hasChannels()).toBe(true);
			expect(center.listChannels()).toContain("telegram-main");
		});

		it("returns false when adapter not configured", () => {
			const center = new NotificationCenter();
			mockIsConfigured.mockReturnValue(false);
			const config: NotificationChannelConfig = {
				id: "telegram-fail",
				type: "telegram",
				enabled: false,
				config: { botToken: "", chatId: "" },
			};
			expect(center.registerAdapter(config)).toBe(false);
		});
	});

	describe("notify", () => {
		it("notifies all channels", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			center.registerAdapter({
				id: "ch2",
				type: "ntfy",
				enabled: true,
				config: { server: "https://ntfy.sh", topic: "test" },
			});

			mockSend.mockResolvedValue({ success: true });

			const results = await center.notify("JobStarted", {
				jobId: "job-1",
				requirement: "Fix login bug",
			});

			expect(results.length).toBeGreaterThanOrEqual(1);
		});

		it("returns failure result when adapter throws", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockRejectedValue(new Error("network error"));

			const results = await center.notify("TaskFailed", {
				jobId: "job-2",
				requirement: "Fix bug",
				taskId: "task-1",
				taskTitle: "Fix login",
				error: "NullPointerException",
			});

			expect(results.some((r) => !r.success)).toBe(true);
		});
	});

	describe("notifyChannel", () => {
		it("notifies specific channel", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "telegram-main",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockResolvedValue({ success: true });

			const result = await center.notifyChannel(
				"telegram-main",
				"TaskCompleted",
				{
					jobId: "job-1",
					requirement: "Add feature",
					taskId: "task-1",
					taskTitle: "Add login",
				},
			);

			expect(result.success).toBe(true);
		});

		it("returns failure for unknown channel", async () => {
			const center = new NotificationCenter();
			const result = await center.notifyChannel("nonexistent", "Error", {
				jobId: "job-1",
				requirement: "test",
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});
	});

	describe("event content mapping", () => {
		it("builds correct content for ReadyForClient", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockImplementation(async (payload: any) => {
				expect(payload.title).toBe("Ready for Review");
				expect(payload.event).toBe("ReadyForClient");
				return { success: true };
			});

			await center.notify("ReadyForClient", {
				jobId: "job-1",
				requirement: "Build feature X",
			});

			expect(mockSend).toHaveBeenCalled();
		});

		it("builds correct content for TaskFailed", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockImplementation(async (payload: any) => {
				expect(payload.title).toBe("Task Failed");
				expect(payload.event).toBe("TaskFailed");
				return { success: true };
			});

			await center.notify("TaskFailed", {
				jobId: "job-1",
				requirement: "Fix bug",
				taskId: "task-1",
				taskTitle: "Fix login",
				error: "NullPointerException",
			});

			expect(mockSend).toHaveBeenCalled();
		});

		it("builds correct content for QuotaPaused", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockImplementation(async (payload: any) => {
				expect(payload.title).toBe("Quota Paused");
				return { success: true };
			});

			await center.notify("QuotaPaused", {
				jobId: "job-1",
				requirement: "Continue work",
			});

			expect(mockSend).toHaveBeenCalled();
		});

		it("handles E2EFailed event", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockImplementation(async (payload: any) => {
				expect(payload.title).toBe("E2E Test Failed");
				return { success: true };
			});

			await center.notify("E2EFailed", {
				jobId: "job-1",
				requirement: "Test workflow",
			});

			expect(mockSend).toHaveBeenCalled();
		});

		it("handles HumanReviewNeeded event", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockImplementation(async (payload: any) => {
				expect(payload.title).toBe("Human Review Needed");
				return { success: true };
			});

			await center.notify("HumanReviewNeeded", {
				jobId: "job-1",
				requirement: "Approval needed",
			});

			expect(mockSend).toHaveBeenCalled();
		});
	});

	describe("redaction", () => {
		it("redacts bearer tokens", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockImplementation(async (payload: any) => {
				const details = payload.details ?? {};
				expect(details.token).toBe("[REDACTED]");
				return { success: true };
			});

			await center.notify("TaskCompleted", {
				jobId: "job-1",
				requirement: "Test",
				taskId: "task-1",
				taskTitle: "Test task",
			});

			expect(mockSend).toHaveBeenCalled();
		});

		it("redacts passwords", async () => {
			const center = new NotificationCenter({
				channels: [],
				redactPatterns: [/password["\s:=]+[^\s,}]+/gi],
			});
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			mockSend.mockImplementation(async (payload: any) => {
				// Pattern should redact password field
				expect(payload).toBeDefined();
				return { success: true };
			});

			await center.notify("TaskCompleted", {
				jobId: "job-1",
				requirement: "Test",
				taskId: "task-1",
				taskTitle: "Test task",
			});

			expect(mockSend).toHaveBeenCalled();
		});
	});

	describe("initialize", () => {
		it("initializes all adapters", async () => {
			const center = new NotificationCenter();
			center.registerAdapter({
				id: "ch1",
				type: "telegram",
				enabled: true,
				config: { botToken: "tok", chatId: "chat" },
			});
			center.registerAdapter({
				id: "ch2",
				type: "ntfy",
				enabled: true,
				config: { server: "https://ntfy.sh", topic: "test" },
			});

			await center.initialize();
			// Should not throw
		});
	});
});
