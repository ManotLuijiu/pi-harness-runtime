/**
 * Server side of the log pipeline: authentication, tenant isolation,
 * durable acceptance and the bounded query service.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	LogCredentialStore,
	LogIndexStore,
	LogIngestService,
	LogOutbox,
	LogOutboxWorker,
	hashToken,
	readBearerToken,
	serverObjectKey,
} from "../src/server/index.js";
import { LOG_SCHEMA_VERSION } from "../src/types.js";

const created: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "log-server-"));
	created.push(dir);
	return dir;
}

afterEach(() => {
	while (created.length > 0) {
		rmSync(created.pop() as string, { recursive: true, force: true });
	}
});

const TOKEN = "install-token-1";

function writeCredentials(dir: string, entries: unknown[]): string {
	const path = join(dir, "log-ingest-credentials.json");
	writeFileSync(path, JSON.stringify({ credentials: entries }));
	return path;
}

function credentialEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "laptop",
		tenantId: "acme",
		label: "laptop",
		scopes: ["logs:write", "logs:read"],
		tokenHash: hashToken(TOKEN),
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function buildService(options: { credentials?: LogCredentialStore } = {}): {
	service: LogIngestService;
	outbox: LogOutbox;
	index: LogIndexStore;
} {
	const dir = tempDir();
	const outbox = new LogOutbox({ dir: join(dir, "outbox") });
	const index = new LogIndexStore({ dir: join(dir, "index") });
	const credentials =
		options.credentials ??
		LogCredentialStore.load({
			path: writeCredentials(dir, [credentialEntry()]),
			env: {},
			keysDir: join(dir, "keys"),
		});
	const service = new LogIngestService({ credentials, outbox, index });
	return { service, outbox, index };
}

function batch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schemaVersion: LOG_SCHEMA_VERSION,
		batchId: "batch-1",
		app: "pi-harness",
		appVersion: "1.2.3",
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

describe("ingest authentication", () => {
	test("refuses every write when no credential is configured", () => {
		const dir = tempDir();
		const credentials = LogCredentialStore.load({
			path: join(dir, "missing.json"),
			env: {},
			keysDir: join(dir, "keys"),
		});
		const { service } = buildService({ credentials });

		const result = service.ingest(batch(), undefined);

		expect(result.status).toBe(503);
		expect(service.configured).toBe(false);
	});

	test("rejects an unknown token", () => {
		const { service } = buildService();

		const result = service.ingest(batch(), "wrong-token");

		expect(result.status).toBe(401);
	});

	test("rejects a missing token", () => {
		const { service } = buildService();

		expect(service.ingest(batch(), undefined).status).toBe(401);
	});

	test("rejects a credential without the write scope", () => {
		const dir = tempDir();
		const credentials = LogCredentialStore.load({
			path: writeCredentials(dir, [credentialEntry({ scopes: ["logs:read"] })]),
			env: {},
			keysDir: join(dir, "keys"),
		});
		const { service } = buildService({ credentials });

		expect(service.ingest(batch(), TOKEN).status).toBe(403);
	});

	test("reads the bearer token case insensitively", () => {
		expect(readBearerToken("Bearer abc")).toBe("abc");
		expect(readBearerToken("bearer abc")).toBe("abc");
		expect(readBearerToken("Basic abc")).toBeUndefined();
		expect(readBearerToken(undefined)).toBeUndefined();
	});

	test("refuses a revoked credential", () => {
		const dir = tempDir();
		const credentials = LogCredentialStore.load({
			path: writeCredentials(dir, [
				credentialEntry({ revokedAt: "2026-02-01T00:00:00.000Z" }),
			]),
			env: {},
			keysDir: join(dir, "keys"),
		});
		const { service } = buildService({ credentials });

		// A revoked credential leaves the store without a usable credential,
		// so the endpoint fails closed instead of accepting the batch.
		expect(service.configured).toBe(false);
		expect(service.ingest(batch(), TOKEN).status).toBe(503);
	});
});

describe("tenant isolation", () => {
	test("derives the tenant from the credential, never from the body", () => {
		const { service, outbox } = buildService();

		const result = service.ingest(batch({ tenantId: "someone-else" }), TOKEN);

		expect(result.status).toBe(202);
		const pending = outbox.listPending();
		expect(pending).toHaveLength(1);
		expect(pending[0].batch.tenantId).toBe("acme");
	});

	test("a query never returns the records of another tenant", () => {
		const { service } = buildService();
		service.ingest(batch(), TOKEN);

		const result = service.query({ tenantId: "someone-else" } as never, TOKEN);

		expect(result.status).toBe(200);
		const body = result.body as { entries: unknown[]; tenantId: string };
		expect(body.tenantId).toBe("acme");
		expect(body.entries).toHaveLength(1);
	});
});

describe("batch validation", () => {
	test("rejects a malformed batch", () => {
		const { service } = buildService();

		expect(service.ingest({ schemaVersion: LOG_SCHEMA_VERSION }, TOKEN).status).toBe(400);
		expect(service.ingest(batch({ records: [] }), TOKEN).status).toBe(400);
		expect(service.ingest(batch({ schemaVersion: 99 }), TOKEN).status).toBe(400);
	});

	test("rejects a record without a timestamp", () => {
		const { service } = buildService();

		const result = service.ingest(
			batch({ records: [{ level: "info", source: "s", event: "e" }] }),
			TOKEN,
		);

		expect(result.status).toBe(400);
	});

	test("requires an installation id in schema v2", () => {
		const { service } = buildService();

		const result = service.ingest(batch({ installationId: undefined }), TOKEN);

		expect(result.status).toBe(400);
	});
});

describe("durable acceptance", () => {
	test("queues the batch and acknowledges it", () => {
		const { service, outbox } = buildService();

		const result = service.ingest(batch(), TOKEN);

		expect(result.status).toBe(202);
		expect(outbox.listPending()).toHaveLength(1);
	});

	test("is idempotent for a repeated batch", () => {
		const { service, outbox } = buildService();

		const first = service.ingest(batch(), TOKEN);
		const second = service.ingest(batch(), TOKEN);

		expect(first.status).toBe(202);
		expect(second.status).toBe(202);
		expect((second.body as { duplicate: boolean }).duplicate).toBe(true);
		expect(outbox.listPending()).toHaveLength(1);
	});

	test("returns a retryable error when the queue is unavailable", () => {
		const dir = tempDir();
		const broken = {
			enqueue: () => {
				throw new Error("disk full");
			},
		} as unknown as LogOutbox;
		const service = new LogIngestService({
			credentials: LogCredentialStore.load({
				path: writeCredentials(dir, [credentialEntry()]),
				env: {},
				keysDir: join(dir, "keys"),
			}),
			outbox: broken,
			index: new LogIndexStore({ dir: join(dir, "index") }),
		});

		const result = service.ingest(batch(), TOKEN);

		expect(result.status).toBe(503);
		expect((result.body as { code: string }).code).toBe("queue_unavailable");
	});
});

describe("outbox worker", () => {
	test("uploads a pending batch and clears the queue", async () => {
		const { service, outbox } = buildService();
		service.ingest(batch(), TOKEN);

		const uploaded: string[] = [];
		const worker = new LogOutboxWorker({
			outbox,
			upload: async (entry) => {
				uploaded.push(entry.batch.batchId);
			},
		});

		const result = await worker.runOnce();

		expect(result.uploaded).toBe(1);
		expect(uploaded).toEqual(["batch-1"]);
		expect(outbox.listPending()).toHaveLength(0);
	});

	test("keeps the batch and retries after a failure", async () => {
		const { service, outbox } = buildService();
		service.ingest(batch(), TOKEN);

		let attempts = 0;
		const worker = new LogOutboxWorker({
			outbox,
			upload: async () => {
				attempts++;
				throw new Error("r2 down");
			},
		});

		const result = await worker.runOnce();

		expect(result.failed).toBe(1);
		expect(outbox.listPending()).toHaveLength(1);
		expect(outbox.stats().failures).toBe(1);
		expect(outbox.stats().lastError).toContain("r2 down");
		expect(attempts).toBe(1);
	});

	test("does not retry a batch before its backoff expired", async () => {
		const { service, outbox } = buildService();
		service.ingest(batch(), TOKEN);

		let attempts = 0;
		const worker = new LogOutboxWorker({
			outbox,
			baseDelayMs: 60_000,
			upload: async () => {
				attempts++;
				throw new Error("r2 down");
			},
		});

		await worker.runOnce();
		const second = await worker.runOnce();

		expect(second.skipped).toBe(1);
		expect(attempts).toBe(1);
	});

	test("reports the queue depth and the oldest pending age", () => {
		const { service, outbox } = buildService();
		service.ingest(batch(), TOKEN);

		const stats = outbox.stats(Date.now() + 5_000);

		expect(stats.pending).toBe(1);
		expect(stats.oldestPendingAgeMs).toBeGreaterThanOrEqual(0);
	});
});

describe("query service", () => {
	test("filters by installation, level and event", () => {
		const { service } = buildService();
		service.ingest(batch(), TOKEN);

		const byLevel = service.query({ levels: ["error"] }, TOKEN);
		expect((byLevel.body as { entries: unknown[] }).entries).toHaveLength(1);

		const byMissingLevel = service.query({ levels: ["debug"] }, TOKEN);
		expect((byMissingLevel.body as { entries: unknown[] }).entries).toHaveLength(0);

		const byInstallation = service.query({ installationId: "other" }, TOKEN);
		expect((byInstallation.body as { entries: unknown[] }).entries).toHaveLength(0);

		const byEvent = service.query({ event: "service.failed" }, TOKEN);
		expect((byEvent.body as { entries: unknown[] }).entries).toHaveLength(1);
	});

	test("never returns the message text", () => {
		const { service } = buildService();
		service.ingest(batch(), TOKEN);

		const result = service.query({}, TOKEN);
		const entries = (result.body as { entries: Record<string, unknown>[] }).entries;

		expect(entries).toHaveLength(1);
		expect(entries[0].message).toBeUndefined();
		expect(entries[0].event).toBe("service.failed");
		expect(entries[0].tenantId).toBe("acme");
	});

	test("bounds the page and paginates with a cursor", () => {
		const { service } = buildService();
		service.ingest(
			batch({
				records: [
					{
						ts: "2026-10-24T09:00:00.000Z",
						level: "info",
						source: "harness.test",
						event: "one",
					},
					{
						ts: "2026-10-24T09:00:01.000Z",
						level: "info",
						source: "harness.test",
						event: "two",
					},
				],
			}),
			TOKEN,
		);

		const first = service.query({ limit: 1 }, TOKEN);
		const firstBody = first.body as { entries: unknown[]; nextCursor?: string; hasMore: boolean };

		expect(firstBody.entries).toHaveLength(1);
		expect(firstBody.hasMore).toBe(true);
		expect(firstBody.nextCursor).toBeTruthy();

		const second = service.query({ limit: 1, cursor: firstBody.nextCursor }, TOKEN);
		expect((second.body as { entries: unknown[] }).entries).toHaveLength(1);
	});

	test("refuses a query without the read scope", () => {
		const dir = tempDir();
		const credentials = LogCredentialStore.load({
			path: writeCredentials(dir, [credentialEntry({ scopes: ["logs:write"] })]),
			env: {},
			keysDir: join(dir, "keys"),
		});
		const { service } = buildService({ credentials });

		expect(service.query({}, TOKEN).status).toBe(403);
	});
});

describe("archive keys", () => {
	test("are generated on the server and contain no user path", () => {
		const key = serverObjectKey({
			tenantId: "../../etc",
			batchId: "batch-1",
			sentAt: "2026-10-24T09:00:00.000Z",
		});

		expect(key.startsWith("logs/")).toBe(true);
		expect(key).not.toContain("..");
		expect(key).toContain("2026/10/24/09");
	});
});

describe("outbox files", () => {
	test("are stored as one file per batch", () => {
		const dir = tempDir();
		const outbox = new LogOutbox({ dir: join(dir, "outbox") });
		outbox.enqueue({
			tenantId: "acme",
			installationId: "11111111-2222-3333-4444-555555555555",
			batchId: "batch-1",
			app: "pi-harness",
			sentAt: "2026-10-24T09:00:00.000Z",
			records: [],
		});

		const files = readdirSync(join(dir, "outbox", "pending"));
		expect(files.filter((name) => name.endsWith(".json") && !name.endsWith(".meta.json"))).toHaveLength(1);
	});
});
