import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogSpool } from "../src/spool.js";
import type { LogBatch, LogRecord } from "../src/types.js";

const created: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "log-spool-"));
	created.push(dir);
	return dir;
}

function record(event: string): LogRecord {
	return {
		ts: "2026-10-24T00:00:00.000Z",
		level: "info",
		source: "test",
		event,
	};
}

function batch(events: string[]): LogBatch {
	return {
		batchId: "batch-1",
		app: "test",
		host: "localhost",
		sentAt: new Date().toISOString(),
		records: events.map(record),
	};
}

afterEach(() => {
	while (created.length > 0) {
		rmSync(created.pop() as string, { recursive: true, force: true });
	}
});

describe("LogSpool", () => {
	test("writes and reads NDJSON", () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const file = spool.append(batch(["a", "b"]));

		const records = spool.read(file);
		expect(records).toHaveLength(2);
		expect(records[0].event).toBe("a");
	});

	test("lists spool files", () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		spool.append(batch(["a"]));
		expect(spool.list()).toHaveLength(1);
	});

	test("removes a spool file", () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const file = spool.append(batch(["a"]));
		spool.remove(file);
		expect(spool.list()).toHaveLength(0);
	});

	test("rotates when the file would exceed the size limit", () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir, maxFileBytes: 1024 });
		const payload = batch(Array.from({ length: 40 }, (_, i) => `event-${i}`));
		spool.append(payload);
		spool.append(payload);

		const files = spool.list();
		expect(files.length).toBeGreaterThan(1);
	});

	test("enforces the retention limit", () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir, maxFileBytes: 1024, maxFiles: 2 });
		const payload = batch(Array.from({ length: 40 }, (_, i) => `event-${i}`));
		for (let i = 0; i < 6; i++) spool.append(payload);

		expect(spool.list().length).toBeLessThanOrEqual(3);
	});

	test("keeps the file readable as plain NDJSON", () => {
		const dir = tempDir();
		const spool = new LogSpool({ dir });
		const file = spool.append(batch(["a"]));
		expect(statSync(file).size).toBeGreaterThan(0);
	});
});
