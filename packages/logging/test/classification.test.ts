/**
 * What may leave the machine.
 *
 * The local log file keeps everything; the centralized archive keeps the
 * structured, sanitized events an operator needs.
 */

import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CLASSIFICATION_POLICY,
	classifyRecord,
	isSanitizedMessage,
	prepareRemoteRecord,
} from "../src/classification.js";
import { LogShipper } from "../src/shipper.js";
import type { LogBatch, LogRecord, LogTransport } from "../src/types.js";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
	return {
		ts: "2026-10-24T09:00:00.000Z",
		level: "info",
		source: "harness.test",
		event: "service.started",
		...overrides,
	};
}

describe("event classification", () => {
	test("keeps structured service events remote", () => {
		expect(classifyRecord(record({ event: "service.started" }))).toBe("remote");
		expect(classifyRecord(record({ event: "harness.service-diagnostics.check" }))).toBe("remote");
		expect(classifyRecord(record({ event: "validation.tier.run" }))).toBe("remote");
	});

	test("keeps the catch-all local log mirror local", () => {
		expect(classifyRecord(record({ event: "harness.log" }))).toBe("local");
	});

	test("keeps prompt and response events local", () => {
		expect(classifyRecord(record({ event: "prompt.received" }))).toBe("local");
		expect(classifyRecord(record({ event: "assistant.response" }))).toBe("local");
	});

	test("keeps unknown events local by default", () => {
		expect(classifyRecord(record({ event: "something.new" }))).toBe("local");
	});
});

describe("message policy", () => {
	test("keeps a short sanitized message", () => {
		expect(isSanitizedMessage("service started in 12 ms", DEFAULT_CLASSIFICATION_POLICY)).toBe(true);
	});

	test("drops a multi line message", () => {
		expect(isSanitizedMessage("line one\nline two", DEFAULT_CLASSIFICATION_POLICY)).toBe(false);
	});

	test("drops a message with an absolute path", () => {
		expect(
			isSanitizedMessage("failed to read /home/tester/project/file.ts", DEFAULT_CLASSIFICATION_POLICY),
		).toBe(false);
	});

	test("drops a message with a URL that has a query string", () => {
		expect(
			isSanitizedMessage("GET https://api.example.com/v1?token=abc failed", DEFAULT_CLASSIFICATION_POLICY),
		).toBe(false);
	});

	test("drops a very long message", () => {
		expect(isSanitizedMessage("x".repeat(500), DEFAULT_CLASSIFICATION_POLICY)).toBe(false);
	});
});

describe("remote preparation", () => {
	test("removes the fields with a private key name", () => {
		const prepared = prepareRemoteRecord(
			record({
				fields: { durationMs: 12, prompt: "private", output: "private", reason: "ok" },
			}),
		);

		expect(prepared?.fields?.prompt).toBeUndefined();
		expect(prepared?.fields?.output).toBeUndefined();
		expect(prepared?.fields?.durationMs).toBe(12);
		expect(prepared?.fields?.reason).toBe("ok");
	});

	test("returns null for a local event", () => {
		expect(prepareRemoteRecord(record({ event: "harness.log", message: "anything" }))).toBeNull();
	});

	test("drops the message but keeps the event", () => {
		const prepared = prepareRemoteRecord(
			record({ event: "service.started", message: "failed at /home/tester/x/y.ts" }),
		);

		expect(prepared?.message).toBeUndefined();
		expect(prepared?.event).toBe("service.started");
	});
});

describe("shipper integration", () => {
	test("does not ship a local-only record", async () => {
		const batches: LogBatch[] = [];
		const transport: LogTransport = {
			name: "recorder",
			async send(batch: LogBatch): Promise<void> {
				batches.push(batch);
			},
		};
		const shipper = new LogShipper({ transports: [transport], flushIntervalMs: 0 });

		shipper.info("harness", "log", "a private local log line");
		await shipper.flush();

		expect(batches).toHaveLength(0);
		expect(shipper.getStats().localOnly).toBe(1);
	});

	test("ships a structured record", async () => {
		const batches: LogBatch[] = [];
		const transport: LogTransport = {
			name: "recorder",
			async send(batch: LogBatch): Promise<void> {
				batches.push(batch);
			},
		};
		const shipper = new LogShipper({ transports: [transport], flushIntervalMs: 0 });

		shipper.info("harness.service-diagnostics", "service.check", "service is up", { durationMs: 3 });
		await shipper.flush();

		expect(batches).toHaveLength(1);
		expect(batches[0].records[0].event).toBe("service.check");
	});
});
