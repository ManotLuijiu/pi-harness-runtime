#!/usr/bin/env bun
/**
 * Telegram 2-Way Communication Example
 *
 * Demonstrates how to:
 * 1. Send a message with Yes/No inline buttons
 * 2. Handle button clicks via webhook
 * 3. Route callbacks to appropriate actions
 *
 * Run:
 *   bun run e2e/telegram-interactive.example.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TelegramCallbackQuery } from "@pi-harness/notification";
import { TelegramAdapter } from "@pi-harness/notification";
import {
	buildCallbackData,
	parseCallbackData,
	createYesNoHandler,
	createTelegramWebhookHandler,
	CallbackActions,
} from "@pi-harness/notification";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface JobManager {
	resume: (jobId: string) => Promise<void>;
	cancel: (jobId: string) => Promise<void>;
	getStatus: (jobId: string) => Promise<string>;
}

// Simulated job manager (replace with real implementation)
const jobManager: JobManager = {
	_jobs: new Map<string, { status: string }>(),

	async resume(jobId: string): Promise<void> {
		console.log(`[JobManager] Resuming job: ${jobId}`);
		this._jobs.set(jobId, { status: "running" });
		// Simulate API call
		await new Promise((r) => setTimeout(r, 100));
		console.log(`[JobManager] Job ${jobId} resumed successfully`);
	},

	async cancel(jobId: string): Promise<void> {
		console.log(`[JobManager] Cancelling job: ${jobId}`);
		this._jobs.set(jobId, { status: "cancelled" });
		await new Promise((r) => setTimeout(r, 100));
		console.log(`[JobManager] Job ${jobId} cancelled`);
	},

	async getStatus(jobId: string): Promise<string> {
		return this._jobs.get(jobId)?.status ?? "unknown";
	},
};

function getTelegramKeys(): { botToken: string; chatId: string } | null {
	const envBotToken = process.env.TEST_TELEGRAM_BOT_TOKEN;
	const envChatId = process.env.TEST_TELEGRAM_CHAT_ID;
	if (envBotToken && envChatId) return { botToken: envBotToken, chatId: envChatId };

	const keysDir = join(homedir(), ".pi-harness-runtime", "keys");
	const botPath = join(keysDir, "telegram-bot-token.txt");
	const chatPath = join(keysDir, "telegram-chat-id.txt");

	if (!existsSync(botPath) || !existsSync(chatPath)) return null;

	try {
		const botToken = readFileSync(botPath, "utf-8").trim();
		const chatId = readFileSync(chatPath, "utf-8").trim();
		return botToken && chatId ? { botToken, chatId } : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Example 1: Send Message with Yes/No Buttons
// ---------------------------------------------------------------------------

async function exampleSendWithButtons(): Promise<void> {
	console.log("\n" + "=".repeat(60));
	console.log("Example 1: Send Message with Yes/No Buttons");
	console.log("=".repeat(60));

	const keys = getTelegramKeys();
	if (!keys) {
		console.log("SKIP: No Telegram keys found");
		return;
	}

	// Create adapter with inline keyboard enabled
	const adapter = new TelegramAdapter({
		botToken: keys.botToken,
		chatId: keys.chatId,
		parseMode: "Markdown",
	});

	// Initialize to verify credentials
	const initialized = await adapter.initialize();
	if (!initialized) {
		console.log("FAIL: Failed to initialize Telegram adapter");
		return;
	}
	console.log("OK: Telegram adapter initialized");

	// Send message with Yes/No buttons
	const jobId = "job-" + Date.now();
	const message = `*Job Approval Required*

Job ID: \`${jobId}\`

Do you want to approve this job to continue?`;

	const response = await fetch(
		`https://api.telegram.org/bot${keys.botToken}/sendMessage`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: keys.chatId,
				text: message,
				parse_mode: "Markdown",
				reply_markup: {
					inline_keyboard: [
						[
							{ text: "✅ Yes, Approve", callback_data: buildCallbackData(CallbackActions.APPROVE, jobId) },
							{ text: "❌ No, Reject", callback_data: buildCallbackData(CallbackActions.REJECT, jobId) },
						],
					],
				},
			}),
		},
	);

	if (response.ok) {
		console.log("OK: Message with buttons sent!");
	} else {
		console.log("FAIL:", await response.text());
	}
}

// ---------------------------------------------------------------------------
// Example 2: Handle Webhook Updates
// ---------------------------------------------------------------------------

async function exampleHandleWebhook(): Promise<void> {
	console.log("\n" + "=".repeat(60));
	console.log("Example 2: Handle Webhook Updates");
	console.log("=".repeat(60));

	const keys = getTelegramKeys();
	if (!keys) {
		console.log("SKIP: No Telegram keys found");
		return;
	}

	// Create adapter
	const adapter = new TelegramAdapter({
		botToken: keys.botToken,
		chatId: keys.chatId,
	});

	// Create callback handler
	const callbackHandler = createYesNoHandler({
		onApprove: async (jobId: string, query: TelegramCallbackQuery) => {
			console.log(`\n[Callback] User ${query.from.username || query.from.first_name} approved job: ${jobId}`);
			await jobManager.resume(jobId);

			// Send confirmation back to user
			await fetch(
				`https://api.telegram.org/bot${keys.botToken}/sendMessage`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: query.from.id,
						text: `✅ Job \`${jobId}\` has been approved and resumed!`,
						parse_mode: "Markdown",
					}),
				},
			);
		},
		onReject: async (jobId: string, query: TelegramCallbackQuery) => {
			console.log(`\n[Callback] User ${query.from.username || query.from.first_name} rejected job: ${jobId}`);
			await jobManager.cancel(jobId);

			// Send confirmation back to user
			await fetch(
				`https://api.telegram.org/bot${keys.botToken}/sendMessage`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: query.from.id,
						text: `❌ Job \`${jobId}\` has been rejected and cancelled.`,
						parse_mode: "Markdown",
					}),
				},
			);
		},
	});

	adapter.setCallbackHandler(callbackHandler);

	// Simulate a webhook update (normally comes from Telegram)
	const mockUpdate = {
		update_id: 123456789,
		callback_query: {
			id: "callback_query_id_123",
			from: {
				id: 123456789,
				is_bot: false,
				first_name: "Test",
				username: "testuser",
			},
			chat_instance: "123456789",
			data: buildCallbackData(CallbackActions.APPROVE, "test-job-123"),
			message: {
				chat: { id: 123456789 },
				message_id: 123,
			},
		},
	};

	console.log("Simulating webhook update with approve callback...");
	await adapter.handleWebhookUpdate(mockUpdate);
	console.log("OK: Webhook update handled");

	// Test reject
	const mockRejectUpdate = {
		update_id: 123456790,
		callback_query: {
			id: "callback_query_id_456",
			from: {
				id: 123456789,
				is_bot: false,
				first_name: "Test",
				username: "testuser",
			},
			chat_instance: "123456789",
			data: buildCallbackData(CallbackActions.REJECT, "test-job-456"),
			message: {
				chat: { id: 123456789 },
				message_id: 124,
			},
		},
	};

	console.log("\nSimulating webhook update with reject callback...");
	await adapter.handleWebhookUpdate(mockRejectUpdate);
	console.log("OK: Reject callback handled");
}

// ---------------------------------------------------------------------------
// Example 3: Custom Buttons with Multiple Actions
// ---------------------------------------------------------------------------

async function exampleCustomButtons(): Promise<void> {
	console.log("\n" + "=".repeat(60));
	console.log("Example 3: Custom Buttons with Multiple Actions");
	console.log("=".repeat(60));

	const keys = getTelegramKeys();
	if (!keys) {
		console.log("SKIP: No Telegram keys found");
		return;
	}

	const jobId = "job-" + Date.now();

	// Create message with custom actions
	const message = `*Job Actions Required*

Job ID: \`${jobId}\`

Choose an action below:`;

	// Custom action buttons
	const customActions = [
		{ text: "🚀 Resume", action: "resume", targetId: jobId },
		{ text: "⏸ Pause", action: "pause", targetId: jobId },
		{ text: "📋 View Logs", action: "view", targetId: jobId },
		{ text: "🗑 Cancel", action: "cancel", targetId: jobId },
	];

	const response = await fetch(
		`https://api.telegram.org/bot${keys.botToken}/sendMessage`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: keys.chatId,
				text: message,
				parse_mode: "Markdown",
				reply_markup: {
					inline_keyboard: [
						// Row 1: Resume and Pause
						customActions.slice(0, 2).map((a) => ({
							text: a.text,
							callback_data: buildCallbackData(a.action, a.targetId),
						})),
						// Row 2: View Logs and Cancel
						customActions.slice(2, 4).map((a) => ({
							text: a.text,
							callback_data: buildCallbackData(a.action, a.targetId),
						})),
					],
				},
			}),
		},
	);

	if (response.ok) {
		console.log("OK: Custom action buttons sent!");
	} else {
		console.log("FAIL:", await response.text());
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	console.log("=".repeat(60));
	console.log("Telegram 2-Way Communication Examples");
	console.log("=".repeat(60));

	await exampleSendWithButtons();
	await exampleHandleWebhook();
	await exampleCustomButtons();

	console.log("\n" + "=".repeat(60));
	console.log("All examples completed!");
	console.log("=".repeat(60));
}

main().catch(console.error);
