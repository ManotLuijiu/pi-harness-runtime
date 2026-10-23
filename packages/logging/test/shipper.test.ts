import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogShipper } from "../src/shipper.js";
import { LogSpool } from "../src/spool.js";
import type { LogBatch, LogTransport } from "../src/types.js";

const created: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "log-shipper-"));
	created.push(dir);
	return dir;
}

function recorder(): { transport: LogTransport; batches: LogBatch[]; fail: boolean } {
	const batches: LogBatch[] = [];
	const state = {
		batches,
		fail: false,
		transport: {
			name: "recorder",
			async send(batch: LogBatch): Promise<void> {
				if (state.fail) throw new Error("transport down");
				batches.push(batch);
			},
		} as LogTransport,
	};
	return state;
}

afterEach(() => {
	while (created.length > 0) {
		rmSync(created.pop() as string, { recursive: true, force: true });
	}
});

describe("LogShipper", () => {
	test("ships buffered records through the transport", async () => {
		const transport = recorder();
		const shipper = new LogShipper({ transports: [transport.transport], flushIntervalMs: 0 });

		shipper.info("unit", "started", "hello");
		await shipper.flush();

		expect(transport.batches).toHaveLength(1);
		expect(transport.batches[0].records[0].event).toBe("started");
		expect(shipper.getStats().shipped).toBe(1);
	});

	test("falls back to the next transport when the first one fails", async () => {
		const failing = recorder();
		failing.fail = true;
		const working = recorder();
		const shipper = new LogShipper({
			transports: [failing.transport, working.transport],
			flushIntervalMs: 0,
		});

		shipper.info("unit", "started");
		await shipper.flush();

		expect(working.batches).toHaveLength(1);
		expect(shipper.getStats().errors.recorder).toBe("transport down");
	});

	test("spools the batch when every transport fails", async () => {
		const failing = recorder();
		failing.fail = true;
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const shipper = new LogShipper({
			transports: [failing.transport],
			spool,
			flushIntervalMs: 0,
		});

		shipper.info("unit", "started");
		await shipper.flush();

		expect(spool.list()).toHaveLength(1);
		expect(shipper.getStats().spooled).toBe(1);
	});

	test("drains the spool on the next successful flush", async () => {
		const failing = recorder();
		failing.fail = true;
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const shipper = new LogShipper({
			transports: [failing.transport],
			spool,
			flushIntervalMs: 0,
		});

		shipper.info("unit", "first");
		await shipper.flush();
		expect(spool.list()).toHaveLength(1);

		failing.fail = false;
		await shipper.flush();

		expect(spool.list()).toHaveLength(0);
		expect(failing.batches).toHaveLength(1);
		expect(failing.batches[0].records[0].event).toBe("first");
	});

	test("redacts secrets before shipping", async () => {
		const transport = recorder();
		const shipper = new LogShipper({ transports: [transport.transport], flushIntervalMs: 0 });

		shipper.info("unit", "login", "token=super-secret-value", { apiKey: "sk-should-not-ship" });
		await shipper.flush();

		const serialized = JSON.stringify(transport.batches[0]);
		expect(serialized).not.toContain("super-secret-value");
		expect(serialized).not.toContain("sk-should-not-ship");
	});

	test("never throws when a producer passes junk", () => {
		const shipper = new LogShipper({ transports: [], flushIntervalMs: 0 });
		expect(() => shipper.log({ level: "info", source: "unit", event: "x", error: "boom" })).not.toThrow();
	});

	test("flushSync spools the remaining records", () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const shipper = new LogShipper({ transports: [], spool, flushIntervalMs: 0 });

		shipper.info("unit", "exit");
		shipper.flushSync();

		expect(spool.list()).toHaveLength(1);
	});

	test("sampling drops debug records below the level", async () => {
		const transport = recorder();
		const shipper = new LogShipper({
			transports: [transport.transport],
			flushIntervalMs: 0,
			sampling: { minLevel: "info", sampleRate: 0 },
		});

		shipper.debug("unit", "noisy");
		shipper.info("unit", "important");
		await shipper.flush();

		expect(transport.batches[0].records).toHaveLength(1);
		expect(transport.batches[0].records[0].event).toBe("important");
	});
});
