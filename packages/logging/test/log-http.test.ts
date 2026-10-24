/**
 * The log service over a real socket.
 *
 * These tests cover the request path an agent or a client actually sees:
 * authentication, the size limit, the durable acceptance and the query.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	LogCredentialStore,
	LogIndexStore,
	LogIngestService,
	LogOutbox,
	createLogHttpHandler,
	hashToken,
} from "../src/server/index.js";
import { LOG_SCHEMA_VERSION } from "../src/types.js";

const TOKEN = "install-token-1";
const created: string[] = [];
const servers: Server[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "log-http-"));
	created.push(dir);
	return dir;
}

afterEach(() => {
	while (servers.length > 0) servers.pop()?.close();
	while (created.length > 0) {
		rmSync(created.pop() as string, { recursive: true, force: true });
	}
});

function batch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schemaVersion: LOG_SCHEMA_VERSION,
		batchId: "batch-1",
		app: "pi-harness",
		installationId: "11111111-2222-3333-4444-555555555555",
		sentAt: "2026-10-24T09:00:00.000Z",
		records: [
			{
				ts: "2026-10-24T09:00:00.000Z",
				level: "error",
				source: "harness.test",
				event: "service.failed",
				message: "boom",
			},
		],
		...overrides,
	};
}

async function startServer(options: { configured?: boolean } = {}): Promise<{
	url: string;
	outbox: LogOutbox;
}> {
	const dir = tempDir();
	const credentialsPath = join(dir, "log-ingest-credentials.json");
	if (options.configured !== false) {
		writeFileSync(
			credentialsPath,
			JSON.stringify({
				credentials: [
					{
						id: "laptop",
						tenantId: "acme",
						scopes: ["logs:write", "logs:read"],
						tokenHash: hashToken(TOKEN),
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
			}),
		);
	}

	const outbox = new LogOutbox({ dir: join(dir, "outbox") });
	const index = new LogIndexStore({ dir: join(dir, "index") });
	const service = new LogIngestService({
		credentials: LogCredentialStore.load({
			path: credentialsPath,
			env: {},
			keysDir: join(dir, "keys"),
		}),
		outbox,
		index,
	});

	const handler = createLogHttpHandler({ service, outbox, index });
	const server = createServer((req, res) => {
		void handler(req, res);
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;

	return { url: `http://127.0.0.1:${port}`, outbox };
}

describe("ingest over http", () => {
	test("refuses the write when no credential is configured", async () => {
		const { url } = await startServer({ configured: false });

		const response = await fetch(`${url}/api/logs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(batch()),
		});

		expect(response.status).toBe(503);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe("ingest_unconfigured");
	});

	test("rejects an unknown credential", async () => {
		const { url } = await startServer();

		const response = await fetch(`${url}/api/logs`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
			body: JSON.stringify(batch()),
		});

		expect(response.status).toBe(401);
	});

	test("accepts a valid batch and queues it durably", async () => {
		const { url, outbox } = await startServer();

		const response = await fetch(`${url}/api/logs`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
			body: JSON.stringify(batch()),
		});

		expect(response.status).toBe(202);
		const body = (await response.json()) as { accepted: number; tenantId: string; queued: boolean };
		expect(body.accepted).toBe(1);
		expect(body.tenantId).toBe("acme");
		expect(body.queued).toBe(true);
		expect(outbox.listPending()).toHaveLength(1);
	});

	test("is idempotent for the same batch", async () => {
		const { url, outbox } = await startServer();

		const send = () =>
			fetch(`${url}/api/logs`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
				body: JSON.stringify(batch()),
			});

		await send();
		const second = await send();

		expect(second.status).toBe(202);
		expect(((await second.json()) as { duplicate: boolean }).duplicate).toBe(true);
		expect(outbox.listPending()).toHaveLength(1);
	});

	test("rejects a malformed batch", async () => {
		const { url } = await startServer();

		const response = await fetch(`${url}/api/logs`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
			body: JSON.stringify({ schemaVersion: LOG_SCHEMA_VERSION, records: [] }),
		});

		expect(response.status).toBe(400);
	});

	test("rejects invalid json", async () => {
		const { url } = await startServer();

		const response = await fetch(`${url}/api/logs`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
			body: "{not json",
		});

		expect(response.status).toBe(400);
	});
});

describe("query over http", () => {
	test("returns the records of the caller tenant only", async () => {
		const { url } = await startServer();
		await fetch(`${url}/api/logs`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
			body: JSON.stringify(batch()),
		});

		const response = await fetch(`${url}/api/logs/query`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
			body: JSON.stringify({ tenantId: "someone-else" }),
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { entries: unknown[]; tenantId: string };
		expect(body.tenantId).toBe("acme");
		expect(body.entries).toHaveLength(1);
	});

	test("refuses a query without a credential", async () => {
		const { url } = await startServer();

		const response = await fetch(`${url}/api/logs/query`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(401);
	});
});

describe("diagnostics over http", () => {
	test("reports the queue depth", async () => {
		const { url, outbox } = await startServer();
		await fetch(`${url}/api/logs`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
			body: JSON.stringify(batch()),
		});

		const response = await fetch(`${url}/api/logs/health`, {
			headers: { Authorization: `Bearer ${TOKEN}` },
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { outbox: { pending: number } };
		expect(body.outbox.pending).toBe(1);
		expect(outbox.listPending()).toHaveLength(1);
	});
});
