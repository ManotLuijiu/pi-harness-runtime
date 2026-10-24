/**
 * The ingest contract: strict validation and allowlisted redaction.
 *
 * The acceptance rule is simple: a secret must not survive the trip, no
 * matter where it hides - in the message, in a structured field, in the
 * error message or in the stack.
 */

import { describe, expect, test } from "bun:test";
import { sanitizeRecord, validateBatch } from "../src/ingest/schema.js";
import { LOG_SCHEMA_VERSION } from "../src/types.js";

function batchWith(records: unknown[], overrides: Record<string, unknown> = {}): unknown {
	return {
		schemaVersion: LOG_SCHEMA_VERSION,
		batchId: "batch-1",
		app: "pi-harness",
		installationId: "11111111-2222-3333-4444-555555555555",
		sentAt: "2026-10-24T09:00:00.000Z",
		records,
		...overrides,
	};
}

const SECRET = "sk-abcdefghijklmnopqrstuvwxyz012345";

describe("validation", () => {
	test("accepts a well formed batch", () => {
		const result = validateBatch(
			batchWith([
				{
					ts: "2026-10-24T09:00:00.000Z",
					level: "info",
					source: "harness.test",
					event: "service.started",
				},
			]),
		);

		expect(result.ok).toBe(true);
	});

	test("accepts a legacy batch without a schema version", () => {
		const result = validateBatch({
			batchId: "batch-legacy",
			app: "pi-harness",
			sentAt: "2026-10-24T09:00:00.000Z",
			records: [
				{
					ts: "2026-10-24T09:00:00.000Z",
					level: "info",
					source: "harness.test",
					event: "service.started",
				},
			],
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.batch.installationId).toBe("legacy");
		}
	});

	test("rejects a newer schema version", () => {
		const result = validateBatch(batchWith([], { schemaVersion: LOG_SCHEMA_VERSION + 1 }));

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("unsupported_schema_version");
	});

	test("rejects too many records", () => {
		const records = Array.from({ length: 5 }, () => ({
			ts: "2026-10-24T09:00:00.000Z",
			level: "info",
			source: "s",
			event: "e",
		}));
		const result = validateBatch(batchWith(records), { limits: { maxRecords: 2 } });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("too_many_records");
	});

	test("rejects an unknown level", () => {
		const result = validateBatch(
			batchWith([
				{ ts: "2026-10-24T09:00:00.000Z", level: "verbose", source: "s", event: "e" },
			]),
		);

		expect(result.ok).toBe(false);
	});
});

describe("allowlist", () => {
	test("drops unknown record properties", () => {
		const result = sanitizeRecord({
			ts: "2026-10-24T09:00:00.000Z",
			level: "info",
			source: "harness.test",
			event: "service.started",
			secretPayload: "should not survive",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect((result.record as Record<string, unknown>).secretPayload).toBeUndefined();
	});

	test("drops field keys that can carry private content", () => {
		const result = sanitizeRecord({
			ts: "2026-10-24T09:00:00.000Z",
			level: "info",
			source: "harness.test",
			event: "service.started",
			fields: {
				prompt: "the user asked something private",
				output: "command output",
				durationMs: 12,
				reason: "timeout",
			},
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.record.fields?.prompt).toBeUndefined();
		expect(result.record.fields?.output).toBeUndefined();
		expect(result.record.fields?.durationMs).toBe(12);
		expect(result.record.fields?.reason).toBe("timeout");
	});
});

describe("redaction", () => {
	test("redacts a secret in the message", () => {
		const result = sanitizeRecord({
			ts: "2026-10-24T09:00:00.000Z",
			level: "info",
			source: "harness.test",
			event: "service.started",
			message: `using ${SECRET} to authenticate`,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.record.message).not.toContain(SECRET);
		expect(result.record.message).toContain("[REDACTED]");
	});

	test("redacts a secret in a structured field", () => {
		const result = sanitizeRecord({
			ts: "2026-10-24T09:00:00.000Z",
			level: "info",
			source: "harness.test",
			event: "service.started",
			fields: { token: SECRET, count: 3 },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(String(result.record.fields?.token)).not.toContain(SECRET);
		expect(result.record.fields?.count).toBe(3);
	});

	test("redacts the error message and the stack", () => {
		const result = sanitizeRecord({
			ts: "2026-10-24T09:00:00.000Z",
			level: "error",
			source: "harness.test",
			event: "service.failed",
			error: {
				name: "AuthError",
				message: `token ${SECRET} rejected`,
				stack: `Error: token ${SECRET} rejected\n    at run (app.js:1:1)`,
			},
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.record.error?.message).not.toContain(SECRET);
		expect(result.record.error?.stack).not.toContain(SECRET);
		expect(result.record.error?.name).toBe("AuthError");
	});
});
