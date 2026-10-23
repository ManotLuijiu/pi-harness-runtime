import { describe, expect, test } from "bun:test";
import { LogBuffer } from "../src/buffer.js";
import type { LogRecord } from "../src/types.js";

function record(level: LogRecord["level"], id: number): LogRecord {
	return {
		ts: "2026-10-24T00:00:00.000Z",
		level,
		source: "test",
		event: `event-${id}`,
	};
}

describe("LogBuffer", () => {
	test("takes records in order and respects the batch size", () => {
		const buffer = new LogBuffer({ maxSize: 10, maxBatchSize: 2 });
		buffer.push(record("info", 1));
		buffer.push(record("info", 2));
		buffer.push(record("info", 3));

		const batch = buffer.takeBatch();
		expect(batch).toHaveLength(2);
		expect(batch[0].event).toBe("event-1");
		expect(buffer.size).toBe(1);
	});

	test("drops the least severe record when full", () => {
		const buffer = new LogBuffer({ maxSize: 2, maxBatchSize: 10 });
		buffer.push(record("error", 1));
		buffer.push(record("info", 2));
		buffer.push(record("debug", 3));

		expect(buffer.dropped).toBe(1);
		const batch = buffer.takeBatch();
		expect(batch.map((item) => item.event)).toEqual(["event-1", "event-3"]);
	});

	test("peekAll does not consume the buffer", () => {
		const buffer = new LogBuffer({ maxSize: 10, maxBatchSize: 10 });
		buffer.push(record("info", 1));
		expect(buffer.peekAll()).toHaveLength(1);
		expect(buffer.size).toBe(1);
	});
});
