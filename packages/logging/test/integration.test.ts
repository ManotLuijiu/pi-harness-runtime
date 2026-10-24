import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebhookTransport } from "../src/transports/webhook.js";
import {
	getCentralShipper,
	initCentralLogging,
	shutdownCentralLogging,
} from "../src/singleton.js";
import type { LogBatch } from "../src/types.js";
import { LOG_SCHEMA_VERSION } from "../src/types.js";

const cleanup: string[] = [];

afterEach(async () => {
	await shutdownCentralLogging();
	while (cleanup.length > 0) {
		rmSync(cleanup.pop() as string, { recursive: true, force: true });
	}
});

/** A tiny HTTP server that records the batches it receives. */
async function startCollector(): Promise<{ url: string; batches: LogBatch[]; server: Server }> {
	const batches: LogBatch[] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			try {
				batches.push(JSON.parse(Buffer.concat(chunks).toString()) as LogBatch);
			} catch {
				// ignore malformed bodies
			}
			res.writeHead(202, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: true }));
		});
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return { url: `http://127.0.0.1:${port}/api/logs`, batches, server };
}

describe("webhook transport", () => {
	test("delivers a batch over HTTP", async () => {
		const collector = await startCollector();
		try {
			const transport = createWebhookTransport({ url: collector.url });
			await transport.send({
				schemaVersion: LOG_SCHEMA_VERSION,
				batchId: "batch-1",
				app: "test",
				installationId: "11111111-2222-3333-4444-555555555555",
				hostLabel: "localhost",
				sentAt: new Date().toISOString(),
				records: [
					{
						ts: new Date().toISOString(),
						level: "info",
						source: "test",
						event: "unit",
					},
				],
			});

			expect(collector.batches).toHaveLength(1);
			expect(collector.batches[0].records[0].event).toBe("unit");
		} finally {
			collector.server.close();
		}
	});

	test("fails loudly when the server rejects the batch", async () => {
		const server = createServer((_req, res) => {
			res.writeHead(500);
			res.end("nope");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		const port = typeof address === "object" && address ? address.port : 0;

		try {
			const transport = createWebhookTransport({ url: `http://127.0.0.1:${port}/api/logs` });
			await expect(
				transport.send({
					schemaVersion: LOG_SCHEMA_VERSION,
					batchId: "batch-2",
					app: "test",
					installationId: "11111111-2222-3333-4444-555555555555",
					hostLabel: "localhost",
					sentAt: new Date().toISOString(),
					records: [
						{
							ts: new Date().toISOString(),
							level: "info",
							source: "test",
							event: "unit",
						},
					],
				}),
			).rejects.toThrow(/HTTP 500/);
		} finally {
			server.close();
		}
	});
});

describe("initCentralLogging", () => {
	test("ships a log record to the configured webhook", async () => {
		const collector = await startCollector();
		const spoolDir = mkdtempSync(join(tmpdir(), "log-central-"));
		cleanup.push(spoolDir);

		try {
			const config = initCentralLogging({
				env: {
					PI_LOG_SINK: "webhook",
					PI_LOG_WEBHOOK_URL: collector.url,
					PI_LOG_SPOOL_DIR: spoolDir,
					PI_LOG_LEVEL: "info",
				},
				keysDir: spoolDir,
			});

			expect(config?.enabled).toBe(true);
			expect(config?.transports).toHaveLength(1);

			getCentralShipper()?.info("unit", "service.central", "hello");
			await getCentralShipper()?.flush();

			expect(collector.batches).toHaveLength(1);
			expect(collector.batches[0].records[0].event).toBe("service.central");
		} finally {
			collector.server.close();
		}
	});
});
