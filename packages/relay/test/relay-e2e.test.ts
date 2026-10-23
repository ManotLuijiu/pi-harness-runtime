/**
 * Relay end-to-end test with a mocked Telegram transport.
 *
 * Flow: mock Telegram webhook (HTTP) -> relay server (WebSocket) -> RelayClient.
 *
 * No production credentials, no real Telegram traffic, no external network.
 * Every wait has a deadline so a broken handshake fails the test instead of
 * hanging the run, and every owned resource is torn down in `finally`.
 */

import { describe, it, expect } from "bun:test";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RelayServer } from "../src/server.js";
import { RelayClient } from "../src/client.js";
import type { CallbackPayload } from "../src/types.js";

const AUTH_TOKEN = "e2e-token";
const WEBHOOK_SECRET = "e2e-webhook-secret";
const OVERALL_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms waiting for ${label}`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		// The timer must not outlive the race: a live timer keeps the test
		// process alive for the full timeout after the assertions passed.
		if (timer) clearTimeout(timer);
	});
}

/**
 * Outbound calls in this test only ever target the loopback mock server.
 * The request is parameterized by host/port/path - no URL string is built.
 */
function postToLoopback(
	port: number,
	path: string,
	secret: string,
	body: unknown,
): Promise<{ status: number; body: string }> {
	if (!LOOPBACK_HOSTS.has("127.0.0.1")) {
		throw new Error("Unexpected host configuration");
	}
	const payload = JSON.stringify(body);

	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
					"x-telegram-bot-api-secret-token": secret,
				},
				timeout: 5000,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c) => chunks.push(c as Buffer));
				res.on("end", () =>
					resolve({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("timeout", () => req.destroy(new Error("webhook request timed out")));
		req.on("error", reject);
		req.end(payload);
	});
}

interface MockTelegram {
	url: string;
	port: number;
	deliver: (payload: CallbackPayload) => void;
	close: () => Promise<void>;
}

/**
 * Mock Telegram webhook: accepts a callback_query POST, validates the secret
 * header and hands the parsed callback to the relay server.
 */
async function startMockTelegram(
	onCallback: (payload: CallbackPayload) => void,
): Promise<MockTelegram> {
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c as Buffer));
		req.on("end", () => {
			if (req.headers["x-telegram-bot-api-secret-token"] !== WEBHOOK_SECRET) {
				res.writeHead(403).end(JSON.stringify({ ok: false, error: "bad secret" }));
				return;
			}

			let body: {
				callback_query?: {
					id: string;
					from: { id: number; username?: string; first_name?: string };
					message?: { message_id?: number; chat?: { id: number } };
					data: string;
				};
			};
			try {
				body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				res.writeHead(400).end(JSON.stringify({ ok: false, error: "bad json" }));
				return;
			}

			const q = body.callback_query;
			if (!q) {
				res.writeHead(400).end(JSON.stringify({ ok: false, error: "no callback_query" }));
				return;
			}

			const [action, ...rest] = q.data.split(":");
			onCallback({
				id: `cb-${q.id}`,
				type: "telegram_callback",
				action,
				targetId: rest.join(":"),
				userId: q.from.id,
				username: q.from.username,
				messageId: q.message?.message_id,
				callbackQueryId: q.id,
				chatId: q.message?.chat?.id,
				timestamp: new Date().toISOString(),
			});

			res.writeHead(200).end(JSON.stringify({ ok: true }));
		});
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const port = (server.address() as AddressInfo).port;

	return {
		url: `http://127.0.0.1:${port}/telegram`,
		port,
		deliver: () => {},
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections?.();
			}),
	};
}

describe("relay end-to-end (mocked Telegram)", () => {
	it("delivers a Telegram callback to the connected client", async () => {
		const relay = new RelayServer({
			port: 0,
			host: "127.0.0.1",
			authToken: AUTH_TOKEN,
		});

		const received: CallbackPayload[] = [];
		let deliverToRelay: (payload: CallbackPayload) => void = () => {};

		const telegram = await startMockTelegram((payload) => deliverToRelay(payload));
		let client: RelayClient | undefined;

		try {
			await relay.start();
			const relayPort = (relay as unknown as { server: Server }).server.address();
			const port = (relayPort as AddressInfo).port;

			deliverToRelay = (payload) => {
				relay.broadcastCallback(payload, false);
			};

			const callbacks: CallbackPayload[] = [];
			const synchronized = new Promise<void>((resolve) => {
				client = new RelayClient(
					{
						serverUrl: `ws://127.0.0.1:${port}`,
						token: AUTH_TOKEN,
						connectTimeout: 5000,
					},
					{
						onCallback: (cb) => {
							callbacks.push(cb);
							received.push(cb);
						},
						onSynchronized: () => resolve(),
					},
				);
			});

			// connect() must resolve once the server confirms authentication
			await withTimeout(client.connect(), OVERALL_TIMEOUT_MS, "client.connect()");
			expect(client.getState().state).toBe("connected");

			// Live events only start after the synchronized marker
			await withTimeout(synchronized, OVERALL_TIMEOUT_MS, "synchronized marker");

			const res = await postToLoopback(
				telegram.port,
				"/telegram",
				WEBHOOK_SECRET,
				{
					update_id: 999,
					callback_query: {
						id: "CBQ_TEST_001",
						from: { id: 1234567890, is_bot: false, first_name: "MANOT", username: "manotlj" },
						message: { message_id: 4797, chat: { id: 1234567890, type: "private" } },
						data: "hi:test-uuid-1234",
					},
				},
			);
			expect(res.status).toBe(200);

			await withTimeout(
				new Promise<void>((resolve) => {
					const check = setInterval(() => {
						if (callbacks.length > 0) {
							clearInterval(check);
							resolve();
						}
					}, 10);
				}),
				OVERALL_TIMEOUT_MS,
				"callback delivery",
			);

			const cb = callbacks[0];
			expect(cb.action).toBe("hi");
			expect(cb.targetId).toBe("test-uuid-1234");
			expect(cb.userId).toBe(1234567890);
			expect(cb.messageId).toBe(4797);
			expect(cb.callbackQueryId).toBe("CBQ_TEST_001");
			expect(cb.chatId).toBe(1234567890);
			expect(cb.username).toBe("manotlj");
			expect(received.length).toBe(1);
		} finally {
			// Always tear down what this test owns
			client?.disconnect();
			await relay.stop().catch(() => {});
			await telegram.close();
		}
	});

	it("accepts nobody when no token is configured", async () => {
		// A relay without a token must not accept a public default secret:
		// the server fails closed (packages/relay/src/server.ts).
		const relay = new RelayServer({
			port: 0,
			host: "127.0.0.1",
		});

		let client: RelayClient | undefined;

		try {
			await relay.start();
			const relayPort = (relay as unknown as { server: Server }).server.address();
			const port = (relayPort as AddressInfo).port;

			client = new RelayClient(
				{
					serverUrl: `ws://127.0.0.1:${port}`,
					// The empty token is the dangerous case: without the
					// fail-closed guard the server would accept it.
					token: "",
					connectTimeout: 5000,
				},
				{},
			);

			await expect(
				withTimeout(client.connect(), OVERALL_TIMEOUT_MS, "client.connect()"),
			).rejects.toThrow();
			expect(client.getState().state).not.toBe("connected");
		} finally {
			client?.disconnect();
			await relay.stop().catch(() => {});
		}
	});

	it("rejects a webhook POST with the wrong secret", async () => {
		const telegram = await startMockTelegram(() => {});
		try {
			const res = await postToLoopback(telegram.port, "/telegram", "wrong-secret", {
				update_id: 1,
			});
			expect(res.status).toBe(403);
		} finally {
			await telegram.close();
		}
	});
});
