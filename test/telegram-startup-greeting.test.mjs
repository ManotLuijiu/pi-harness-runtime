import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramAdapter } from '../packages/notification/dist/adapters/telegram-adapter.js';

test('Telegram startup greeting verifies delivery without exposing credentials', async (t) => {
  const originalFetch = globalThis.fetch;
  const adapter = new TelegramAdapter({ botToken: 'test-token', chatId: '12345' });
  try {
    await t.test('sends exactly Hi to the configured chat with a timeout', async () => {
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.telegram.org/bottest-token/sendMessage');
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { chat_id: '12345', text: 'Hi' });
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json({ ok: true, result: { message_id: 42 } });
      };
      assert.equal((await adapter.sendStartupGreeting()).success, true);
      assert.equal(calls, 1);
    });
    for (const [name, status, body] of [
      ['blocked bot', 403, { ok: false }],
      ['invalid chat', 400, { ok: false }],
      ['API rejection with HTTP 200', 200, { ok: false }],
      ['missing delivery receipt', 200, { ok: true }],
    ]) {
      await t.test(name, async () => {
        globalThis.fetch = async () => Response.json(body, { status });
        assert.equal((await adapter.sendStartupGreeting()).success, false);
      });
    }
    await t.test('network failure does not leak token-bearing URLs', async () => {
      globalThis.fetch = async () => { throw new Error('https://api.telegram.org/bottest-token/sendMessage'); };
      const result = await adapter.sendStartupGreeting();
      assert.equal(result.success, false);
      assert.ok(!result.error.includes('test-token'));
    });
    await t.test('timeout reports failure', async () => {
      globalThis.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
      assert.equal((await adapter.sendStartupGreeting()).success, false);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
