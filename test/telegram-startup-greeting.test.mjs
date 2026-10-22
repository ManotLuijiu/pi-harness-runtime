/**
 * Telegram startup greeting: delivery verification without leaking credentials.
 *
 * The cases are FLAT top-level tests (no nested `t.test()`), because Bun's
 * node:test shim does not support a test registered inside another test
 * ("test() inside another test() is not yet implemented in Bun"). Keeping the
 * file flat makes it runnable under both `node --test` and `bun test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { TelegramAdapter } from '../packages/notification/dist/adapters/telegram-adapter.js';

const BOT_TOKEN = 'test-token';
const CHAT_ID = '12345';

/** Run `fn` with a stubbed global fetch and always restore the original. */
async function withStubbedFetch(fn) {
	const originalFetch = globalThis.fetch;
	try {
		await fn();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

test('sends Hi with a reply button to the configured chat with a timeout', async () => {
	await withStubbedFetch(async () => {
		const adapter = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID });
		let calls = 0;
		globalThis.fetch = async (url, options) => {
			calls++;
			assert.equal(url, `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
			assert.equal(options.method, 'POST');
			const body = JSON.parse(options.body);
			assert.equal(body.chat_id, CHAT_ID);
			// The greeting is prefixed with the host name ("[<host>] Hi! ..."),
			// so assert the greeting word itself, not the start of the message.
			assert.match(body.text, /^(\[.*?\]\s*)?Hi!/);
			const button = body.reply_markup.inline_keyboard[0][0];
			assert.equal(button.text, 'Say Hi back');
			assert.match(button.callback_data, /^hi:/);
			assert.ok(Buffer.byteLength(button.callback_data) <= 64);
			assert.ok(options.signal instanceof AbortSignal);
			return Response.json({ ok: true, result: { message_id: 42 } });
		};
		assert.equal((await adapter.sendStartupGreeting()).success, true);
		assert.equal(calls, 1);
	});
});

for (const [name, status, body] of [
	['blocked bot', 403, { ok: false }],
	['invalid chat', 400, { ok: false }],
	['API rejection with HTTP 200', 200, { ok: false }],
	['missing delivery receipt', 200, { ok: true }],
]) {
	test(`startup greeting reports failure: ${name}`, async () => {
		await withStubbedFetch(async () => {
			const adapter = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID });
			globalThis.fetch = async () => Response.json(body, { status });
			assert.equal((await adapter.sendStartupGreeting()).success, false);
		});
	});
}

test('network failure does not leak token-bearing URLs', async () => {
	await withStubbedFetch(async () => {
		const adapter = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID });
		globalThis.fetch = async () => {
			throw new Error(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
		};
		const result = await adapter.sendStartupGreeting();
		assert.equal(result.success, false);
		assert.ok(!result.error.includes(BOT_TOKEN));
	});
});

test('timeout reports failure', async () => {
	await withStubbedFetch(async () => {
		const adapter = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID });
		globalThis.fetch = async () => {
			throw new DOMException('Timed out', 'TimeoutError');
		};
		assert.equal((await adapter.sendStartupGreeting()).success, false);
	});
});

test('polling receives Hi callback, acknowledges once, and does not create agent work', async () => {
	await withStubbedFetch(async () => {
		const a = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID });
		let buttonData;
		let verified = 0;
		let edits = 0;
		let agentInputs = 0;
		let approvalCalls = 0;
		let updates = [];
		a.setGreetingVerifiedHandler(() => verified++);
		a.setMessageHandler(async () => agentInputs++);
		a.setCallbackHandler(() => approvalCalls++);
		globalThis.fetch = async (url, options) => {
			const body = JSON.parse(options.body);
			if (url.endsWith('/sendMessage')) {
				buttonData = body.reply_markup.inline_keyboard[0][0].callback_data;
				return Response.json({ ok: true, result: { message_id: 42 } });
			}
			if (url.endsWith('/getUpdates')) {
				assert.ok(body.allowed_updates.includes('callback_query'));
				return Response.json({ ok: true, result: updates });
			}
			if (url.endsWith('/editMessageText')) {
				edits++;
				assert.equal(body.message_id, 42);
				assert.match(body.text, /Hi back received/);
				assert.deepEqual(body.reply_markup, { inline_keyboard: [] });
			}
			return Response.json({ ok: true });
		};
		await a.sendStartupGreeting();
		assert.equal(a.isGreetingVerified(), false);
		const query = {
			id: 'click', data: buttonData, chat_instance: 'test',
			from: { id: 12345, is_bot: false, first_name: 'Test' },
			message: { chat: { id: 12345 }, message_id: 42 },
		};
		updates = [{ update_id: 1, callback_query: query }];
		await a.poll();
		assert.equal(a.isGreetingVerified(), true);
		await a.processUpdate({ update_id: 1, callback_query: query });
		assert.equal(verified, 1);
		assert.equal(edits, 1);
		assert.equal(agentInputs, 0);
		assert.equal(approvalCalls, 0);
	});
});

test('wrong chat, sender, message and expired button cannot verify inbound', async () => {
	await withStubbedFetch(async () => {
		const a = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID });
		let token;
		let edits = 0;
		globalThis.fetch = async (url, options) => {
			if (url.endsWith('/sendMessage')) {
				token = JSON.parse(options.body).reply_markup.inline_keyboard[0][0].callback_data;
				return Response.json({ ok: true, result: { message_id: 42 } });
			}
			if (url.endsWith('/editMessageText')) edits++;
			return Response.json({ ok: true });
		};
		await a.sendStartupGreeting();
		const oldToken = token;
		await a.sendStartupGreeting();
		const base = { id: 'click', data: token, from: { id: 12345, is_bot: false }, message: { chat: { id: 12345 }, message_id: 42 } };
		for (const query of [
			{ ...base, message: { chat: { id: 999 }, message_id: 42 } },
			{ ...base, from: { id: 999, is_bot: false } },
			{ ...base, message: { chat: { id: 12345 }, message_id: 43 } },
			{ ...base, data: oldToken },
		]) await a.processUpdate({ callback_query: query });
		assert.equal(a.isGreetingVerified(), false);
		assert.equal(edits, 0);
	});
});

test('failed reply acknowledgment can retry without falsely verifying', async () => {
	await withStubbedFetch(async () => {
		const a = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID });
		let token;
		let succeeds = false;
		globalThis.fetch = async (url, options) => {
			if (url.endsWith('/sendMessage')) {
				token = JSON.parse(options.body).reply_markup.inline_keyboard[0][0].callback_data;
				return Response.json({ ok: true, result: { message_id: 42 } });
			}
			return Response.json({ ok: url.endsWith('/editMessageText') ? succeeds : true });
		};
		await a.sendStartupGreeting();
		const query = { id: 'click', data: token, from: { id: 12345, is_bot: false }, message: { chat: { id: 12345 }, message_id: 42 } };
		await a.processUpdate({ callback_query: query });
		assert.equal(a.isGreetingVerified(), false);
		succeeds = true;
		await a.processUpdate({ callback_query: query });
		assert.equal(a.isGreetingVerified(), true);
	});
});

test('only one poll is in flight and shutdown aborts it', async () => {
	await withStubbedFetch(async () => {
		const a = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID });
		let calls = 0;
		let signal;
		globalThis.fetch = async (_url, options) => {
			calls++;
			signal = options.signal;
			return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
		};
		const pending = a.poll();
		await a.poll();
		assert.equal(calls, 1);
		a.stopPolling();
		await pending;
		assert.equal(signal.aborted, true);
	});
});
