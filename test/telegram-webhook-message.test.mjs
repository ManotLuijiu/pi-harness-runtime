/**
 * The Telegram adapter must work with a REMOTE webhook server.
 *
 * Two defects made the two-way Telegram path slow and lossy:
 *
 *  1. The harness started the getUpdates poll even though a webhook server
 *     owns the bot. Telegram rejects getUpdates while a webhook is active,
 *     and every rejected poll also terminates the getUpdates stream of the
 *     OTHER poller of the same bot - the inbound text messages were delayed
 *     by seconds. A 409 must now stop the poll loop instead of hammering it.
 *  2. A text message that arrived through the webhook was only logged, never
 *     forwarded to the message handler, so the harness never saw it.
 *
 * The notification package ships its compiled output (`dist/`), so this test
 * exercises the **dist** (the artifact that actually runs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "packages", "notification");

const { TelegramAdapter } = await import(
	join(packageRoot, "dist", "adapters", "telegram-adapter.js")
);

// The pure helpers: the allow-list rule of the remote server and the mapping
// of a relayed message onto a Telegram update.
const { isAuthorizedTelegramSender } = await import(
	join(here, "..", "harness", "telegram-auth.ts")
);
const { buildTelegramMessageUpdate } = await import(
	join(here, "..", "harness", "telegram-update.ts")
);

function makeAdapter(chatId = "42") {
	return new TelegramAdapter({ botToken: "test-token", chatId });
}

test("a text message from the webhook reaches the message handler", async () => {
	const adapter = makeAdapter();
	const seen = [];
	adapter.setMessageHandler(async (text, chatId) => {
		seen.push({ text, chatId });
	});

	await adapter.handleWebhookUpdate({
		message: {
			message_id: 7,
			from: { id: 42, is_bot: false, username: "tester" },
			chat: { id: 42 },
			text: "Say Hi",
		},
	});

	assert.deepEqual(seen, [{ text: "Say Hi", chatId: "42" }]);
});

test("a message from a bot is not forwarded", async () => {
	const adapter = makeAdapter();
	const seen = [];
	adapter.setMessageHandler(async (text) => {
		seen.push(text);
	});

	await adapter.handleWebhookUpdate({
		message: {
			message_id: 8,
			from: { id: 42, is_bot: true },
			chat: { id: 42 },
			text: "I am a bot",
		},
	});

	assert.deepEqual(seen, [], "a bot message never reaches the handler");
});

test("a message from another chat is not forwarded", async () => {
	const adapter = makeAdapter("42");
	const seen = [];
	adapter.setMessageHandler(async (text) => {
		seen.push(text);
	});

	await adapter.handleWebhookUpdate({
		message: {
			message_id: 9,
			from: { id: 99, is_bot: false },
			chat: { id: 99 },
			text: "wrong chat",
		},
	});

	assert.deepEqual(seen, [], "a message of another chat never reaches the handler");
});

test("a 409 getUpdates stops the poll loop instead of hammering it", async () => {
	const originalFetch = globalThis.fetch;
	const originalHome = process.env.HOME;
	const dir = mkdtempSync(join(tmpdir(), "telegram-409-home-"));
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return {
			ok: false,
			status: 409,
			text: async () => "Conflict: terminated by other getUpdates request",
		};
	};
	try {
		// The key file decides the branch: without a webhook file the poll is
		// the only inbound path, with one the webhook owns the bot.
		process.env.HOME = dir;
		const adapter = makeAdapter();
		adapter.startPolling();
		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.equal(
			adapter.isPolling(),
			false,
			"the poll loop stopped after the 409 rejection",
		);
		assert.equal(calls, 1, "the adapter did not keep calling getUpdates");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}
});

test("a 409 while a webhook owns the bot reports the broken inbound path", async () => {
	const originalFetch = globalThis.fetch;
	const originalHome = process.env.HOME;
	const dir = mkdtempSync(join(tmpdir(), "telegram-409-webhook-home-"));
	const keysDir = join(dir, ".pi-harness-runtime", "keys");
	mkdirSync(keysDir, { recursive: true });
	writeFileSync(join(keysDir, "telegram-webhook-url.txt"), "https://example.invalid/telegram");
	globalThis.fetch = async () => ({
		ok: false,
		status: 409,
		text: async () => "Conflict: can't use getUpdates method while webhook is active",
	});
	try {
		process.env.HOME = dir;
		const adapter = makeAdapter();
		const reasons = [];
		adapter.onPollStopped = (reason) => reasons.push(reason);

		adapter.startPolling();
		await new Promise((resolve) => setTimeout(resolve, 60));

		assert.equal(adapter.isPolling(), false, "the poll loop stopped");
		assert.equal(reasons.length, 1, "the reason was reported once");
		assert.match(reasons[0], /409/, "the reason names the Telegram error");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}
});

test("a message is not forwarded when no chat id is configured", async () => {
	const adapter = new TelegramAdapter({ botToken: "test-token" });
	const seen = [];
	adapter.setMessageHandler(async (text) => {
		seen.push(text);
	});

	await adapter.handleWebhookUpdate({
		message: {
			message_id: 10,
			from: { id: 42, is_bot: false },
			chat: { id: 42 },
			text: "no chat configured",
		},
	});

	assert.deepEqual(seen, [], "without a chat id nobody may write into Pi");
});

test("a 409 without a webhook schedules a bounded retry and reports the reason", async () => {
	const originalFetch = globalThis.fetch;
	const originalHome = process.env.HOME;
	const dir = mkdtempSync(join(tmpdir(), "telegram-409-home-"));
	globalThis.fetch = async () => ({
		ok: false,
		status: 409,
		text: async () => "Conflict: terminated by other getUpdates request",
	});
	try {
		process.env.HOME = dir;
		const adapter = makeAdapter();
		// A short backoff so the test does not wait for the real one.
		adapter.pollRetryBaseDelayMs = 1;
		adapter.pollRetryMaxAttempts = 2;
		const reasons = [];
		adapter.onPollStopped = (reason) => reasons.push(reason);

		adapter.startPolling();
		await new Promise((resolve) => setTimeout(resolve, 60));

		assert.equal(adapter.isPolling(), false, "the poll loop stopped after the 409 rejection");
		assert.equal(reasons.length, 1, "the reason was reported once");
		assert.match(reasons[0], /409/, "the reason names the Telegram error");
		assert.match(
			adapter.getPollStopReason() ?? "",
			/409/,
			"the stop reason is readable for the startup summary",
		);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}
});

test("a rejected retry keeps the retry chain alive and gives up only once", async () => {
	const originalFetch = globalThis.fetch;
	const originalHome = process.env.HOME;
	const dir = mkdtempSync(join(tmpdir(), "telegram-409-retry-home-"));
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return {
			ok: false,
			status: 409,
			text: async () => "Conflict: terminated by other getUpdates request",
		};
	};
	try {
		process.env.HOME = dir;
		const adapter = makeAdapter();
		adapter.pollRetryBaseDelayMs = 1;
		adapter.pollRetryMaxAttempts = 3;
		const reasons = [];
		adapter.onPollStopped = (reason) => reasons.push(reason);

		adapter.startPolling();
		await new Promise((resolve) => setTimeout(resolve, 80));

		// The first poll plus every retry was tried - a rejected retry does
		// not end the chain.
		assert.ok(calls >= 2, `the retry chain kept polling (calls: ${calls})`);
		assert.equal(reasons.length, 1, "the reason was reported exactly once");
		assert.match(reasons[0], /retries exhausted/, "the final reason is the permanent one");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}
});

test("a message without a sender is not forwarded", async () => {
	const adapter = makeAdapter();
	const seen = [];
	adapter.setMessageHandler(async (text) => {
		seen.push(text);
	});

	// An update without a sender has no identity: nobody may write in.
	await adapter.handleWebhookUpdate({
		message: {
			message_id: 11,
			chat: { id: 42 },
			text: "anonymous",
		},
	});

	assert.deepEqual(seen, [], "a message without a sender never reaches the handler");
});

test("only the sender may write in - the allow-list rule of the server", () => {
	// An allow-list is authoritative.
	assert.equal(isAuthorizedTelegramSender(new Set([42]), 1234567890, 42), true);
	assert.equal(isAuthorizedTelegramSender(new Set([42]), 1234567890, 99), false);
	// Without an allow-list the chat id identifies the sender (a direct chat).
	assert.equal(isAuthorizedTelegramSender(new Set(), 42, 42), true);
	assert.equal(isAuthorizedTelegramSender(new Set(), 42, 99), false);
	// Fail closed: neither an allow-list nor a chat id -> nobody.
	assert.equal(isAuthorizedTelegramSender(new Set(), undefined, 42), false);
	// Fail closed: a missing sender is never authorized.
	assert.equal(isAuthorizedTelegramSender(new Set([42]), 42, undefined), false);
});

test("the relay mapping keeps the bot flag and hides the text in the ids", () => {
	const update = buildTelegramMessageUpdate({
		userId: 42,
		username: "tester",
		messageId: 7,
		chatId: 42,
		text: "Say Hi",
		isBot: true,
	});

	assert.ok(update, "a payload with text produces an update");
	assert.equal(update.message.from.is_bot, true, "the real bot flag survives the transport");
	assert.equal(update.message.text, "Say Hi", "the text is forwarded");
	assert.ok(
		!JSON.stringify({ ...update.message, text: "" }).includes("Say Hi"),
		"the text only appears in the text field",
	);
	assert.equal(
		buildTelegramMessageUpdate({ userId: 42, text: "" }),
		null,
		"a payload without text produces no update",
	);
});

test("the server never puts the user text into the target id", () => {
	const source = readFileSync(
		join(here, "..", "scripts", "unified-webhook-server.ts"),
		"utf8",
	);
	assert.match(
		source,
		/`msg-\$\{message\.message_id/,
		"the target id is built from the message id",
	);
	assert.doesNotMatch(
		source,
		/createCallbackPayload\(\s*"telegram_message",[\s\S]{0,400}?text\.slice/,
		"the user text is never sliced into the target id",
	);
});

test("isWebhookConfigured follows the webhook url file", () => {
	const originalHome = process.env.HOME;
	const dir = mkdtempSync(join(tmpdir(), "telegram-webhook-home-"));
	try {
		process.env.HOME = dir;
		const adapter = makeAdapter();
		assert.equal(adapter.isWebhookConfigured(), false, "no webhook file -> polling is allowed");

		const keysDir = join(dir, ".pi-harness-runtime", "keys");
		mkdirSync(keysDir, { recursive: true });
		writeFileSync(join(keysDir, "telegram-webhook-url.txt"), "https://example.invalid/telegram");
		assert.equal(
			adapter.isWebhookConfigured(),
			true,
			"a webhook file -> polling must stay off",
		);
	} finally {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}
});

test("a 409 reports the stop reason exactly once per polling lifecycle", async () => {
	const originalHome = process.env.HOME;
	const dir = mkdtempSync(join(tmpdir(), "telegram-webhook-409-"));
	const originalFetch = globalThis.fetch;
	try {
		process.env.HOME = dir;
		const keysDir = join(dir, ".pi-harness-runtime", "keys");
		mkdirSync(keysDir, { recursive: true });
		// A webhook owns the bot: polling can never work -> report once.
		writeFileSync(join(keysDir, "telegram-webhook-url.txt"), "https://example.invalid/telegram");

		const adapter = makeAdapter();
		const reports = [];
		adapter.onPollStopped = (reason) => reports.push(reason);
		globalThis.fetch = async () =>
			new Response(JSON.stringify({ ok: false, error_code: 409 }), { status: 409 });

		adapter.startPolling();
		await new Promise((r) => setTimeout(r, 50));
		assert.equal(reports.length, 1, "the first 409 reports the reason");
		assert.match(reports[0], /409/);

		// A second 409 in the SAME lifecycle must not report again.
		await adapter.poll();
		assert.equal(reports.length, 1, "the reason is reported exactly once");
		assert.equal(adapter.isPolling(), false, "the poll loop is stopped");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}
});

test("the authorization rule is ONE implementation and refuses a group chat", async () => {
	// The shared rule: the SENDER decides. A group chat whose id is
	// allow-listed must not let every member in.
	assert.equal(isAuthorizedTelegramSender([42], 42, 42), true, "the sender is allowed");
	assert.equal(isAuthorizedTelegramSender([42], -100, 7), false, "a group member is refused");
	assert.equal(isAuthorizedTelegramSender([], 42, 42), true, "the chat id identifies the sender");
	assert.equal(isAuthorizedTelegramSender([], 42, 7), false, "another sender is refused");
	assert.equal(isAuthorizedTelegramSender([], undefined, 7), false, "without a chat id nobody may");
	assert.equal(isAuthorizedTelegramSender([42], 42, undefined), false, "a sender-less update is refused");

	// The adapter must delegate to that rule (no second, more permissive copy).
	const adapterSource = readFileSync(
		join(packageRoot, "dist", "adapters", "telegram-adapter.js"),
		"utf8",
	);
	assert.match(
		adapterSource,
		/isAuthorizedTelegramSender/,
		"the adapter uses the shared authorization rule",
	);
	assert.doesNotMatch(
		adapterSource,
		/allowed\.includes\(chatNum\)/,
		"the adapter does not authorize by the chat id of the allow-list",
	);

	// The remote server must delegate as well.
	const serverSource = readFileSync(
		join(here, "..", "scripts", "unified-webhook-server.ts"),
		"utf8",
	);
	assert.match(
		serverSource,
		/isAuthorizedTelegramSender/,
		"the remote server uses the shared authorization rule",
	);
});

test("the relayed callback keeps the real bot flag", async () => {
	const { buildTelegramCallbackUpdate } = await import(
		join(here, "..", "harness", "telegram-update.ts")
	);
	const update = buildTelegramCallbackUpdate({
		id: "c1",
		action: "hi",
		targetId: "token",
		userId: 42,
		username: "tester",
		messageId: 7,
		chatId: 42,
		isBot: true,
	});
	assert.ok(update, "a valid payload produces an update");
	assert.equal(update.callback_query.from.is_bot, true, "a bot callback stays a bot");
	assert.equal(update.callback_query.data, "hi:token");
	assert.equal(update.callback_query.message.chat.id, 42);
	assert.equal(
		buildTelegramCallbackUpdate({ id: "c2", userId: "not-a-number" }),
		null,
		"a payload without a numeric sender produces no update",
	);

	// The remote must transport the real flag for a button callback too.
	const serverSource = readFileSync(
		join(here, "..", "scripts", "unified-webhook-server.ts"),
		"utf8",
	);
	assert.match(
		serverSource,
		/from\.is_bot === true/,
		"the remote sends the real bot flag",
	);
});

test("a bot may not press a button", async () => {
	const adapter = makeAdapter();
	const seen = [];
	adapter.setCallbackHandler(async (data) => {
		seen.push(data);
	});

	await adapter.handleWebhookUpdate({
		callback_query: {
			id: "cb1",
			from: { id: 42, is_bot: true, first_name: "Bot" },
			chat_instance: "ci",
			data: "approve:task-1",
			message: { chat: { id: 42 }, message_id: 3 },
		},
	});

	assert.deepEqual(seen, [], "a bot callback never reaches the handler");
});

test("an unauthorized sender may not press a button", async () => {
	const adapter = makeAdapter("42");
	const seen = [];
	adapter.setCallbackHandler(async (data) => {
		seen.push(data);
	});

	await adapter.handleWebhookUpdate({
		callback_query: {
			id: "cb2",
			from: { id: 99, is_bot: false, first_name: "Other" },
			chat_instance: "ci",
			data: "approve:task-1",
			message: { chat: { id: 42 }, message_id: 3 },
		},
	});

	assert.deepEqual(seen, [], "another user may not press the button");
});

test("the polling path refuses a sender-less, a bot and an unauthorized message", async () => {
	const adapter = makeAdapter("42");
	const seen = [];
	adapter.setMessageHandler(async (text) => {
		seen.push(text);
	});

	// processUpdate() is private, but the test drives the real path.
	await adapter.processUpdate({
		update_id: 1,
		message: { message_id: 1, chat: { id: 42 }, text: "no sender" },
	});
	await adapter.processUpdate({
		update_id: 2,
		message: {
			message_id: 2,
			from: { id: 42, is_bot: true },
			chat: { id: 42 },
			text: "from a bot",
		},
	});
	await adapter.processUpdate({
		update_id: 3,
		message: {
			message_id: 3,
			from: { id: 99, is_bot: false },
			chat: { id: 42 },
			text: "from another user",
		},
	});

	assert.deepEqual(seen, [], "only an authorized sender reaches the handler");
});

test("the polling offset advances even when the handler throws", async () => {
	const originalHome = process.env.HOME;
	const originalFetch = globalThis.fetch;
	const dir = mkdtempSync(join(tmpdir(), "telegram-webhook-offset-"));
	try {
		process.env.HOME = dir;
		const adapter = makeAdapter("42");
		adapter.setMessageHandler(async () => {
			throw new Error("the agent is not ready");
		});

		const offsets = [];
		globalThis.fetch = async (_url, init) => {
			offsets.push(JSON.parse(init.body).offset);
			return new Response(
				JSON.stringify({
					ok: true,
					result: [
						{
							update_id: 5,
							message: {
								message_id: 1,
								from: { id: 42, is_bot: false },
								chat: { id: 42 },
								text: "Say Hi",
							},
						},
					],
				}),
				{ status: 200 },
			);
		};

		await adapter.poll();
		await adapter.poll();

		// The same update must not be delivered again: the offset advanced
		// even though the handler threw.
		assert.equal(offsets.length, 2);
		assert.equal(offsets[0], 0, "the first poll starts at the beginning");
		assert.equal(offsets[1], 6, "the offset advanced past the failed update");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}
});
