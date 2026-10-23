import { describe, expect, test } from "bun:test";
import { LogSampler } from "../src/sampler.js";
import type { LogRecord } from "../src/types.js";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
	return {
		ts: "2026-10-24T00:00:00.000Z",
		level: "info",
		source: "test",
		event: "unit",
		...overrides,
	};
}

describe("LogSampler", () => {
	test("drops records below the minimum level", () => {
		const sampler = new LogSampler({ minLevel: "warn" });
		expect(sampler.shouldLog(record({ level: "info" }))).toBe(false);
		expect(sampler.shouldLog(record({ level: "warn" }))).toBe(true);
	});

	test("keeps errors regardless of level", () => {
		const sampler = new LogSampler({ minLevel: "error" });
		expect(sampler.shouldLog(record({ level: "error" }))).toBe(true);
	});

	test("applies the sample rate deterministically to debug records", () => {
		const sampler = new LogSampler({ minLevel: "debug", sampleRate: 0 });
		expect(sampler.shouldLog(record({ level: "debug" }))).toBe(false);

		const always = new LogSampler({ minLevel: "debug", sampleRate: 1 });
		expect(always.shouldLog(record({ level: "debug" }))).toBe(true);
	});

	test("rate limits repeated events per minute", () => {
		const sampler = new LogSampler({ minLevel: "debug", sampleRate: 1, rateLimitPerMinute: 2 });
		const now = 1_700_000_000_000;
		expect(sampler.shouldLog(record({ level: "info" }), now)).toBe(true);
		expect(sampler.shouldLog(record({ level: "info" }), now)).toBe(true);
		expect(sampler.shouldLog(record({ level: "info" }), now)).toBe(false);
	});

	test("rate limit window rolls over", () => {
		const sampler = new LogSampler({ minLevel: "debug", sampleRate: 1, rateLimitPerMinute: 1 });
		const now = 1_700_000_000_000;
		expect(sampler.shouldLog(record({ level: "info" }), now)).toBe(true);
		expect(sampler.shouldLog(record({ level: "info" }), now + 60_000)).toBe(true);
	});

	test("errors are exempt from the rate limit", () => {
		const sampler = new LogSampler({ minLevel: "debug", sampleRate: 1, rateLimitPerMinute: 1 });
		const now = 1_700_000_000_000;
		expect(sampler.shouldLog(record({ level: "info" }), now)).toBe(true);
		expect(sampler.shouldLog(record({ level: "error" }), now)).toBe(true);
		expect(sampler.shouldLog(record({ level: "error" }), now)).toBe(true);
	});
});
