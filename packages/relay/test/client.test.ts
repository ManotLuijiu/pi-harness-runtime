/**
 * RelayClient connect() lifecycle tests.
 *
 * Deterministic and localhost-only: no Telegram transport, no production
 * credentials, no external network. The fixture speaks the relay protocol
 * directly so every handshake outcome is reproducible.
 */

import { describe, it, expect } from "bun:test";
import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RelayClient } from "../src/client.js";

const TEST_TOKEN = "test-token-123";

type FixtureMode =
	/** authenticate successfully, then send snapshot + synchronized */
	| "ok"
	/** receive the auth message but never answer it */
	| "silent"
	/** close the socket immediately, before authentication */
	| "close"
	/** answer with an explicit authentication failure */
	| "reject";

interface Fixture {
	url: string;
	port: number;
	close: () => Promise<void>;
	connectionCount: () => number;
	dropConnections: () => void;
}

async function startFixture(mode: FixtureMode): Promise<Fixture> {
	const httpServer: Server = createServer();
	const wss = new WebSocketServer({ server: httpServer });
	await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
	const port = (httpServer.address() as AddressInfo).port;

	let connections = 0;

	wss.on("connection", (ws: WebSocket) => {
		connections++;

		if (mode === "close") {
			ws.close();
			return;
		}

		ws.on("message", (data) => {
			let msg: { type?: string; payload?: { token?: string } };
			try {
				msg = JSON.parse(data.toString());
			} catch {
				return;
			}
			if (msg.type !== "auth") return;

			if (mode === "silent") return; // never answer: caller must time out

			if (mode === "reject" || msg.payload?.token !== TEST_TOKEN) {
				ws.send(
					JSON.stringify({
						version: 1,
						type: "auth",
						payload: { success: false, error: "Invalid token" },
					}),
				);
				return;
			}

			ws.send(
				JSON.stringify({
					version: 1,
					type: "auth",
					payload: { success: true, sessionId: "sess-fixture-1" },
				}),
			);
			ws.send(
				JSON.stringify({
					version: 1,
					type: "snapshot",
					payload: {
						sessionId: "sess-fixture-1",
						serverVersion: "fixture",
						connectedClients: 1,
						recentCallbacks: [],
					},
				}),
			);
			ws.send(JSON.stringify({ version: 1, type: "synchronized", payload: {} }));
		});
	});

	return {
		url: `ws://127.0.0.1:${port}`,
		port,
		connectionCount: () => connections,
		dropConnections: () => {
			for (const client of wss.clients) client.close();
		},
		close: () =>
			new Promise<void>((resolve) => {
				for (const client of wss.clients) client.terminate();
				wss.close();
				// Never let a stuck socket hang the test run
				const guard = setTimeout(resolve, 500);
				httpServer.close(() => {
					clearTimeout(guard);
					resolve();
				});
			}),
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("RelayClient.connect", () => {
	it("resolves once the server confirms authentication", async () => {
		const fixture = await startFixture("ok");
		const connected: string[] = [];
		const client = new RelayClient(
			{ serverUrl: fixture.url, token: TEST_TOKEN, connectTimeout: 2000 },
			{ onConnected: (sessionId) => connected.push(sessionId) },
		);

		await client.connect();

		expect(client.getState().state).toBe("connected");
		expect(client.getSessionId()).toBe("sess-fixture-1");
		expect(connected).toEqual(["sess-fixture-1"]);

		client.disconnect();
		await fixture.close();
	});

	it("rejects when the server never answers authentication", async () => {
		const fixture = await startFixture("silent");
		const client = new RelayClient({
			serverUrl: fixture.url,
			token: TEST_TOKEN,
			connectTimeout: 250,
		});

		await expect(client.connect()).rejects.toThrow(/timeout/i);

		client.disconnect();
		await fixture.close();
	});

	it("rejects with the server error when authentication fails", async () => {
		const fixture = await startFixture("reject");
		const errors: Error[] = [];
		const client = new RelayClient(
			{ serverUrl: fixture.url, token: "wrong-token", connectTimeout: 2000 },
			{ onError: (err) => errors.push(err) },
		);

		await expect(client.connect()).rejects.toThrow(/Invalid token/);
		expect(errors.length).toBeGreaterThan(0);

		await fixture.close();
	});

	it("rejects when the socket closes before the client is ready", async () => {
		const fixture = await startFixture("close");
		const client = new RelayClient({
			serverUrl: fixture.url,
			token: TEST_TOKEN,
			connectTimeout: 2000,
		});

		await expect(client.connect()).rejects.toThrow(/closed before ready/i);

		await fixture.close();
	});

	it("rejects when the server is unreachable", async () => {
		// Bind and immediately release a port so nothing is listening on it
		const fixture = await startFixture("ok");
		const deadUrl = fixture.url;
		await fixture.close();

		const client = new RelayClient({
			serverUrl: deadUrl,
			token: TEST_TOKEN,
			connectTimeout: 2000,
		});

		await expect(client.connect()).rejects.toThrow();
	});

	it("rejects a pending connect when disconnect() is called", async () => {
		const fixture = await startFixture("silent");
		const client = new RelayClient({
			serverUrl: fixture.url,
			token: TEST_TOKEN,
			connectTimeout: 5000,
		});

		const pending = client.connect();
		await sleep(50);
		client.disconnect();

		await expect(pending).rejects.toThrow(/Disconnected/);

		await fixture.close();
	});

	it("reconnects after an unexpected drop and stops after disconnect()", async () => {
		const fixture = await startFixture("ok");
		const client = new RelayClient({
			serverUrl: fixture.url,
			token: TEST_TOKEN,
			connectTimeout: 2000,
		});

		await client.connect();
		expect(fixture.connectionCount()).toBe(1);

		// Unexpected loss of the connection -> the client should reconnect
		fixture.dropConnections();
		await sleep(1600);
		expect(fixture.connectionCount()).toBe(2);

		// Deliberate shutdown must not schedule another reconnect
		client.disconnect();
		await sleep(1600);
		expect(fixture.connectionCount()).toBe(2);

		await fixture.close();
	});

	it("stops heartbeat activity after disconnect()", async () => {
		const fixture = await startFixture("ok");
		const client = new RelayClient({
			serverUrl: fixture.url,
			token: TEST_TOKEN,
			keepAlive: 50,
			connectTimeout: 2000,
		});

		await client.connect();
		client.disconnect();

		const before = fixture.connectionCount();
		await sleep(300);
		expect(fixture.connectionCount()).toBe(before);

		await fixture.close();
	});

	it("opens a NEW socket when connect() follows a disconnect()", async () => {
		// Regression: connect() used to hand out the already-settled promise, so
		// `disconnect(); connect();` never opened a second socket.
		const fixture = await startFixture("ok");
		const client = new RelayClient({
			serverUrl: fixture.url,
			token: TEST_TOKEN,
			connectTimeout: 2000,
		});

		const first = client.connect();
		client.disconnect();
		await expect(first).rejects.toThrow(/Disconnected/);

		await client.connect();
		expect(client.getState().state).toBe("connected");
		expect(client.getSessionId()).toBe("sess-fixture-1");
		// The first socket was closed before the handshake completed, so the
		// server only ever saw the NEW one.
		expect(fixture.connectionCount()).toBeGreaterThanOrEqual(1);

		client.disconnect();
		await fixture.close();
	});

	it("does not retry a failed connect by default", async () => {
		const fixture = await startFixture("close");
		const client = new RelayClient({
			serverUrl: fixture.url,
			token: TEST_TOKEN,
			connectTimeout: 1000,
		});

		await expect(client.connect()).rejects.toThrow(/closed before ready/i);
		await sleep(1400);
		expect(fixture.connectionCount()).toBe(1);

		client.disconnect();
		await fixture.close();
	});

	it("retries a failed connect when retryOnConnectFailure is enabled", async () => {
		const fixture = await startFixture("close");
		const client = new RelayClient({
			serverUrl: fixture.url,
			token: TEST_TOKEN,
			connectTimeout: 1000,
			retryOnConnectFailure: true,
		});

		await expect(client.connect()).rejects.toThrow(/closed before ready/i);
		// The backoff starts at 1000ms.
		await sleep(1600);
		expect(fixture.connectionCount()).toBeGreaterThan(1);

		client.disconnect();
		await fixture.close();
	});
});
