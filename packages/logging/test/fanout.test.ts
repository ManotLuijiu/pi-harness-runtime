/**
 * The delivery semantics of the shipper.
 *
 * Two modes:
 *   - `fallback` (the default): the transports form a chain, the first one
 *     that accepts the batch wins and the later ones are not called.
 *   - `fanout` (explicit opt-in): every transport receives the batch, each
 *     one tracks its own success, and the batch is only spooled when EVERY
 *     transport failed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogShipper } from "../src/shipper.js";
import { LogSpool } from "../src/spool.js";
import type { LogBatch, LogTransport } from "../src/types.js";

const created: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "log-fanout-"));
	created.push(dir);
	return dir;
}

afterEach(() => {
	while (created.length > 0) {
		rmSync(created.pop() as string, { recursive: true, force: true });
	}
});

interface RecordingTransport extends LogTransport {
	batches: LogBatch[];
}

function transport(name: string, fail = false): RecordingTransport {
	const batches: LogBatch[] = [];
	return {
		name,
		batches,
		async send(batch: LogBatch): Promise<void> {
			if (fail) throw new Error(`${name} is down`);
			batches.push(batch);
		},
	};
}

/** A shipper that delivers one record per flush. */
function buildShipper(options: {
	transports: LogTransport[];
	delivery?: "fallback" | "fanout";
	spoolDir?: string;
}): LogShipper {
	return new LogShipper({
		app: "pi-harness",
		installationId: "install-1",
		transports: options.transports,
		delivery: options.delivery,
		spool: options.spoolDir ? new LogSpool({ dir: options.spoolDir }) : undefined,
		buffer: { maxSize: 10, maxBatchSize: 1 },
		flushIntervalMs: 0,
	});
}

describe("the fallback delivery", () => {
	test("the first transport that accepts the batch wins", async () => {
		const first = transport("r2");
		const second = transport("webhook");
		const shipper = buildShipper({ transports: [first, second] });

		shipper.info("unit", "service.started", "boom");
		await shipper.flush();

		expect(first.batches).toHaveLength(1);
		expect(second.batches).toHaveLength(0);
	});

	test("a failing transport hands over to the next one", async () => {
		const first = transport("r2", true);
		const second = transport("webhook");
		const shipper = buildShipper({ transports: [first, second] });

		shipper.info("unit", "service.started", "boom");
		await shipper.flush();

		expect(first.batches).toHaveLength(0);
		expect(second.batches).toHaveLength(1);
	});

	test("the batch is spooled when every transport failed", async () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const shipper = buildShipper({
			transports: [transport("r2", true), transport("webhook", true)],
			spoolDir: dir,
		});

		shipper.info("unit", "service.started", "boom");
		await shipper.flush();

		expect(spool.list().length).toBe(1);
	});
});

describe("the fanout delivery", () => {
	test("every transport receives the batch", async () => {
		const first = transport("r2");
		const second = transport("webhook");
		const shipper = buildShipper({ transports: [first, second], delivery: "fanout" });

		shipper.info("unit", "service.started", "boom");
		await shipper.flush();

		expect(first.batches).toHaveLength(1);
		expect(second.batches).toHaveLength(1);
	});

	test("a failing transport does not stop the others", async () => {
		const first = transport("r2", true);
		const second = transport("webhook");
		const shipper = buildShipper({ transports: [first, second], delivery: "fanout" });

		shipper.info("unit", "service.started", "boom");
		await shipper.flush();

		expect(first.batches).toHaveLength(0);
		expect(second.batches).toHaveLength(1);
	});

	test("the batch is not spooled when one transport accepted it", async () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const shipper = buildShipper({
			transports: [transport("r2", true), transport("webhook")],
			delivery: "fanout",
			spoolDir: dir,
		});

		shipper.info("unit", "service.started", "boom");
		await shipper.flush();

		expect(spool.list()).toHaveLength(0);
	});

	test("the batch is spooled when every transport failed", async () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const shipper = buildShipper({
			transports: [transport("r2", true), transport("webhook", true)],
			delivery: "fanout",
			spoolDir: dir,
		});

		shipper.info("unit", "service.started", "boom");
		await shipper.flush();

		expect(spool.list()).toHaveLength(1);
	});

	test("every transport tracks its own delivery state", async () => {
		const first = transport("r2", true);
		const second = transport("webhook");
		const shipper = buildShipper({ transports: [first, second], delivery: "fanout" });

		shipper.info("unit", "service.started", "boom");
		await shipper.flush();

		const status = shipper.getTransportStatus();
		expect(status).toHaveLength(2);
		const r2 = status.find((entry) => entry.name === "r2");
		const webhook = status.find((entry) => entry.name === "webhook");
		expect(r2?.failed).toBe(1);
		expect(r2?.delivered).toBe(0);
		expect(r2?.lastError).toContain("r2 is down");
		expect(webhook?.delivered).toBe(1);
		expect(webhook?.failed).toBe(0);
		expect(webhook?.lastSuccessAt).toBeDefined();
	});

	test("the fallback is the default", () => {
		const shipper = buildShipper({ transports: [transport("r2")] });
		expect(shipper.deliveryMode).toBe("fallback");
	});
});
