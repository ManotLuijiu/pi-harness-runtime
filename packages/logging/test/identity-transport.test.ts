/**
 * Client side identity and transport semantics.
 *
 * The transports form a FALLBACK chain, not a broadcast: the first transport
 * that accepts a batch wins and the later ones are never called. This file
 * documents that behaviour explicitly, because a silent "broadcast" would
 * duplicate every batch.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogShipper } from "../src/shipper.js";
import { resolveInstallationId } from "../src/installation.js";
import { resolveLogSinkConfig } from "../src/config.js";
import { LOG_SCHEMA_VERSION, type LogBatch, type LogTransport } from "../src/types.js";

const created: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "log-identity-"));
	created.push(dir);
	return dir;
}

afterEach(() => {
	while (created.length > 0) {
		rmSync(created.pop() as string, { recursive: true, force: true });
	}
});

function recorder(name: string): { transport: LogTransport; batches: LogBatch[] } {
	const batches: LogBatch[] = [];
	return {
		batches,
		transport: {
			name,
			async send(batch: LogBatch): Promise<void> {
				batches.push(batch);
			},
		},
	};
}

describe("transport semantics", () => {
	test("stops at the first successful transport - the chain is not a broadcast", async () => {
		const first = recorder("first");
		const second = recorder("second");
		const shipper = new LogShipper({
			transports: [first.transport, second.transport],
			flushIntervalMs: 0,
		});

		shipper.info("unit", "service.started");
		await shipper.flush();

		expect(first.batches).toHaveLength(1);
		expect(second.batches).toHaveLength(0);
	});

	test("uses the next transport only when the first one fails", async () => {
		const failing = recorder("first");
		failing.transport = {
			name: "first",
			async send(): Promise<void> {
				throw new Error("transport down");
			},
		};
		const second = recorder("second");
		const shipper = new LogShipper({
			transports: [failing.transport, second.transport],
			flushIntervalMs: 0,
		});

		shipper.info("unit", "service.started");
		await shipper.flush();

		expect(second.batches).toHaveLength(1);
	});
});

describe("batch schema v2", () => {
	test("carries the schema version, the installation id and the app version", async () => {
		const transport = recorder("only");
		const shipper = new LogShipper({
			app: "pi-harness",
			appVersion: "9.9.9",
			installationId: "11111111-2222-3333-4444-555555555555",
			hostLabel: "laptop",
			transports: [transport.transport],
			flushIntervalMs: 0,
		});

		shipper.info("unit", "service.started");
		await shipper.flush();

		const batch = transport.batches[0];
		expect(batch.schemaVersion).toBe(LOG_SCHEMA_VERSION);
		expect(batch.installationId).toBe("11111111-2222-3333-4444-555555555555");
		expect(batch.appVersion).toBe("9.9.9");
		expect(batch.hostLabel).toBe("laptop");
		expect(batch.batchId.length).toBeGreaterThan(0);
	});

	test("does not send the hostname as an identity", async () => {
		const transport = recorder("only");
		const shipper = new LogShipper({
			installationId: "11111111-2222-3333-4444-555555555555",
			transports: [transport.transport],
			flushIntervalMs: 0,
		});

		shipper.info("unit", "service.started");
		await shipper.flush();

		const batch = transport.batches[0];
		// The hostname may travel as a display label, but the identity is the
		// installation id.
		expect(batch.installationId).not.toBe(batch.hostLabel);
	});
});

describe("installation identity", () => {
	test("creates the id once and reuses it", () => {
		const dir = tempDir();
		const path = join(dir, "installation-id.txt");

		const first = resolveInstallationId({ path });
		const second = resolveInstallationId({ path });

		expect(first).toBe(second);
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf8").trim()).toBe(first);
	});

	test("replaces an invalid id file", () => {
		const dir = tempDir();
		const path = join(dir, "installation-id.txt");
		writeFileSync(path, "not-a-uuid\n");

		const id = resolveInstallationId({ path });

		expect(id).not.toBe("not-a-uuid");
		expect(readFileSync(path, "utf8").trim()).toBe(id);
	});
});

describe("transport selection", () => {
	const env = {
		PI_LOG_R2_BUCKET: "bucket",
		PI_LOG_R2_ACCESS_KEY_ID: "ak",
		PI_LOG_R2_SECRET_ACCESS_KEY: "sk",
		PI_LOG_R2_ENDPOINT: "https://example.invalid",
	};

	test("auto prefers the webhook ingress so only the server writes to R2", () => {
		const config = resolveLogSinkConfig({
			env: { ...env, PI_LOG_WEBHOOK_URL: "https://logs.example.invalid/api/logs" },
			keysDir: join(tempDir(), "keys"),
			installationId: "install",
		});

		expect(config.transports.map((transport) => transport.name)).toEqual(["webhook"]);
		expect(config.notes.join(" ")).toContain("client ingress point");
	});

	test("auto falls back to R2 when no webhook is configured", () => {
		const config = resolveLogSinkConfig({
			env,
			keysDir: join(tempDir(), "keys"),
			installationId: "install",
		});

		expect(config.transports.map((transport) => transport.name)).toEqual(["r2"]);
	});

	test("r2+webhook keeps the explicit order (R2 first, webhook as fallback)", () => {
		const config = resolveLogSinkConfig({
			env: { ...env, PI_LOG_SINK: "r2+webhook", PI_LOG_WEBHOOK_URL: "https://logs.example.invalid/api/logs" },
			keysDir: join(tempDir(), "keys"),
			installationId: "install",
		});

		expect(config.transports.map((transport) => transport.name)).toEqual(["r2", "webhook"]);
	});

	test("the installation id reaches the resolved config", () => {
		const config = resolveLogSinkConfig({
			env: { PI_LOG_SINK: "off" },
			keysDir: join(tempDir(), "keys"),
			installationId: "install",
		});

		expect(config.installationId).toBe("install");
	});
});
