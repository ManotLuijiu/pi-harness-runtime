/**
 * Tests for the validation ledger - the durable record of which tier ran.
 *
 * The ledger is the only mechanical answer to "did the final tier pass?", so
 * it must survive malformed input, report the latest run of a tier and never
 * throw into its caller.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ValidationLedger,
	defaultLedgerPath,
	parseLedgerContent,
	parseRunRecord,
} from "../src/validation-ledger.js";
import type { TodoItem } from "../src/todo-provider.js";

let dir: string;
let path: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "validation-ledger-"));
	path = join(dir, "validation-runs.jsonl");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function itemWithPlan(metadata: Record<string, unknown>): TodoItem {
	return {
		id: 1,
		subject: "staged work",
		status: "in_progress",
		metadata,
	};
}

const PLAN = {
	validationPlan: {
		fast: { command: "bun test tests/fast", expectedDurationMs: 18_000, datasetSize: 100 },
		full: { command: "bun test tests/full", expectedDurationMs: 2_400_000, datasetSize: 10_000 },
		budgetMinutes: 90,
		finalTierRequired: true,
	},
};

describe("parseRunRecord", () => {
	it("reads a complete record", () => {
		const record = parseRunRecord(
			JSON.stringify({
				ts: "2026-10-24T00:00:00.000Z",
				tier: "full",
				status: "passed",
				itemId: 3,
				durationMs: 1200,
			}),
		);
		expect(record?.tier).toBe("full");
		expect(record?.status).toBe("passed");
		expect(record?.itemId).toBe(3);
		expect(record?.durationMs).toBe(1200);
	});

	it("rejects malformed lines", () => {
		expect(parseRunRecord("")).toBeNull();
		expect(parseRunRecord("not json")).toBeNull();
		expect(parseRunRecord("[]")).toBeNull();
		expect(parseRunRecord(JSON.stringify({ tier: "medium", status: "passed" }))).toBeNull();
		expect(parseRunRecord(JSON.stringify({ tier: "fast", status: "weird" }))).toBeNull();
	});
});

describe("parseLedgerContent", () => {
	it("skips malformed lines and keeps the rest", () => {
		const content = [
			JSON.stringify({ ts: "2026-10-24T00:00:00.000Z", tier: "fast", status: "passed" }),
			"garbage",
			"",
			JSON.stringify({ ts: "2026-10-24T00:01:00.000Z", tier: "full", status: "failed" }),
		].join("\n");
		const records = parseLedgerContent(content);
		expect(records).toHaveLength(2);
		expect(records[1].tier).toBe("full");
	});
});

describe("ValidationLedger", () => {
	it("writes NDJSON that can be read back", () => {
		const ledger = new ValidationLedger({ path });
		ledger.record({ tier: "fast", status: "passed", itemId: 1, durationMs: 500 });

		const raw = readFileSync(path, "utf-8");
		expect(raw.trim().split("\n")).toHaveLength(1);
		expect(JSON.parse(raw.trim()).tier).toBe("fast");
		expect(ledger.read()).toHaveLength(1);
	});

	it("keeps only the runs of the requested item", () => {
		const ledger = new ValidationLedger({ path });
		ledger.record({ tier: "fast", status: "passed", itemId: 1 });
		ledger.record({ tier: "fast", status: "passed", itemId: 2 });
		expect(ledger.runsFor(1)).toHaveLength(1);
		expect(ledger.runsFor(3)).toHaveLength(0);
	});

	it("returns the latest run of a tier", () => {
		const ledger = new ValidationLedger({ path });
		ledger.record({ tier: "fast", status: "failed", itemId: 1, ts: "2026-10-24T00:00:00.000Z" });
		ledger.record({ tier: "fast", status: "passed", itemId: 1, ts: "2026-10-24T00:05:00.000Z" });
		const latest = ledger.latestFor(1, "fast");
		expect(latest?.status).toBe("passed");
	});

	it("mirrors every record to the sink", () => {
		const mirrored: string[] = [];
		const ledger = new ValidationLedger({ path, onRecord: (r) => mirrored.push(r.tier) });
		ledger.record({ tier: "fast", status: "passed", itemId: 1 });
		ledger.record({ tier: "full", status: "passed", itemId: 1 });
		expect(mirrored).toEqual(["fast", "full"]);
	});

	it("never throws when the sink throws", () => {
		const ledger = new ValidationLedger({
			path,
			onRecord: () => {
				throw new Error("sink is broken");
			},
		});
		expect(() => ledger.record({ tier: "fast", status: "passed", itemId: 1 })).not.toThrow();
		expect(ledger.read()).toHaveLength(1);
	});

	it("rotates the file when it grows past the limit", () => {
		const ledger = new ValidationLedger({ path, maxBytes: 200 });
		for (let i = 0; i < 10; i++) {
			ledger.record({ tier: "fast", status: "passed", itemId: i, note: "x".repeat(50) });
		}
		expect(existsSync(`${path}.1`)).toBe(true);
	});

	it("reports a pending final tier until the full tier passed", () => {
		const ledger = new ValidationLedger({ path });
		const item = itemWithPlan(PLAN);

		expect(ledger.stateFor(item).finalTierPending).toBe(true);
		expect(ledger.isFinalTierPending(item)).toBe(true);

		ledger.record({ tier: "fast", status: "passed", itemId: 1 });
		expect(ledger.stateFor(item).finalTierPending).toBe(true);

		ledger.record({ tier: "full", status: "failed", itemId: 1 });
		expect(ledger.stateFor(item).finalTierPending).toBe(true);

		ledger.record({ tier: "full", status: "passed", itemId: 1 });
		expect(ledger.stateFor(item).finalTierPending).toBe(false);
		expect(ledger.stateFor(item).full.status).toBe("passed");
	});

	it("reports no pending tier for an item without a plan", () => {
		const ledger = new ValidationLedger({ path });
		const item: TodoItem = { id: 9, subject: "plain", status: "in_progress" };
		const state = ledger.stateFor(item);
		expect(state.hasPlan).toBe(false);
		expect(state.finalTierPending).toBe(false);
	});

	it("survives a truncated file", () => {
		writeFileSync(path, '{"ts":"2026-10-24T00:00:00.000Z","tier":"fast","status":"passed"}\n{"ts":"2026-10-2');
		const ledger = new ValidationLedger({ path });
		expect(ledger.read()).toHaveLength(1);
	});

	it("uses a default path under the harness home", () => {
		expect(defaultLedgerPath()).toContain(".pi-harness-runtime");
		expect(defaultLedgerPath().endsWith("validation-runs.jsonl")).toBe(true);
	});
});
