/**
 * Tests for the staged validation plan.
 *
 * The plan is what lets the harness say "run the cheap tier while the code
 * changes, run the expensive tier once at the end" instead of letting the
 * agent repeat a 40 minute regression after every fix.
 */

import { describe, it, expect } from "bun:test";
import {
	parseValidationPlan,
	formatValidationContext,
	buildValidationSteerSuffix,
	parseDurationMs,
	formatDuration,
	parseTier,
} from "../src/validation-plan.js";
import type { TodoItem } from "../src/todo-provider.js";

function item(metadata?: Record<string, unknown>): TodoItem {
	return {
		id: 1,
		subject: "seed data",
		status: "in_progress",
		metadata,
	};
}

describe("parseValidationPlan", () => {
	it("returns null when the todo declares no plan", () => {
		expect(parseValidationPlan(item())).toBeNull();
		expect(parseValidationPlan(item({ other: "value" }))).toBeNull();
		expect(parseValidationPlan(null)).toBeNull();
	});

	it("parses object tiers with cost and dataset size", () => {
		const plan = parseValidationPlan(
			item({
				validationPlan: {
					fast: { command: "bun test fast", expectedDurationMs: 18000, datasetSize: 100 },
					full: { command: "bun test full", expectedDurationMs: 2400000, datasetSize: 10000 },
				},
			}),
		);
		expect(plan?.fast?.command).toBe("bun test fast");
		expect(plan?.fast?.expectedDurationMs).toBe(18000);
		expect(plan?.fast?.datasetSize).toBe(100);
		expect(plan?.full?.expectedDurationMs).toBe(2400000);
	});

	it("parses plain command strings as tiers", () => {
		const plan = parseValidationPlan(
			item({ validationPlan: { fast: "bun test fast", full: "bun test full" } }),
		);
		expect(plan?.fast?.command).toBe("bun test fast");
		expect(plan?.full?.command).toBe("bun test full");
	});

	it("parses flat command aliases and duration strings", () => {
		const plan = parseValidationPlan(
			item({ validationPlan: { fastCommand: "bun test fast", fullCommand: "bun test full", budgetMinutes: 90 } }),
		);
		expect(plan?.fast?.command).toBe("bun test fast");
		expect(plan?.full?.command).toBe("bun test full");
		expect(plan?.budgetMinutes).toBe(90);
	});

	it("reads a duration given as a string", () => {
		const plan = parseValidationPlan(
			item({ validationPlan: { full: { command: "bun test full", expectedDuration: "40m" } } }),
		);
		expect(plan?.full?.expectedDurationMs).toBe(40 * 60 * 1000);
	});

	it("keeps finalTierRequired and notes", () => {
		const plan = parseValidationPlan(
			item({
				validationPlan: {
					fast: "bun test fast",
					full: "bun test full",
					finalTierRequired: true,
					notes: "fast tier must cover the aggregate query",
				},
			}),
		);
		expect(plan?.finalTierRequired).toBe(true);
		expect(plan?.notes).toBe("fast tier must cover the aggregate query");
	});

	it("returns null for a plan that declares nothing usable", () => {
		expect(parseValidationPlan(item({ validationPlan: { fast: {} } }))).toBeNull();
		expect(parseValidationPlan(item({ validationPlan: "not an object" }))).toBeNull();
	});
});

describe("duration helpers", () => {
	it("parses explicit units", () => {
		expect(parseDurationMs("45s")).toBe(45_000);
		expect(parseDurationMs("40m")).toBe(2_400_000);
		expect(parseDurationMs("1h")).toBe(3_600_000);
		expect(parseDurationMs("1h30m")).toBe(5_400_000);
		expect(parseDurationMs("garbage")).toBeUndefined();
		expect(parseDurationMs("")).toBeUndefined();
	});

	it("treats a bare number below 1000 as seconds", () => {
		expect(parseDurationMs(45)).toBe(45_000);
		expect(parseDurationMs(45_000)).toBe(45_000);
	});

	it("formats durations for a status line", () => {
		expect(formatDuration(18_000)).toBe("18s");
		expect(formatDuration(2_400_000)).toBe("40m");
		expect(formatDuration(5_400_000)).toBe("1h 30m");
		expect(formatDuration(3_600_000)).toBe("1h");
	});
});

describe("parseTier", () => {
	it("ignores empty tiers", () => {
		expect(parseTier("", "fast")).toBeUndefined();
		expect(parseTier({}, "fast")).toBeUndefined();
		expect(parseTier(undefined, "fast")).toBeUndefined();
	});

	it("keeps a label-only tier", () => {
		const tier = parseTier({ label: "unit tests" }, "fast");
		expect(tier?.label).toBe("unit tests");
	});
});

describe("formatValidationContext", () => {
	it("is empty when there is no plan", () => {
		expect(formatValidationContext({})).toBe("");
		expect(buildValidationSteerSuffix(item())).toBe("");
	});

	it("states both tiers and the staged rule", () => {
		const plan = parseValidationPlan(
			item({
				validationPlan: {
					fast: { command: "bun test fast", expectedDurationMs: 18_000, datasetSize: 100 },
					full: { command: "bun test full", expectedDurationMs: 2_400_000, datasetSize: 10_000 },
					finalTierRequired: true,
				},
			}),
		);
		const text = formatValidationContext(plan!);
		expect(text).toContain("fast=");
		expect(text).toContain("full=");
		expect(text).toContain("bun test fast");
		expect(text).toContain("~18s");
		expect(text).toContain("100 records");
		expect(text).toContain("bun test full");
		expect(text).toContain("~40m");
		expect(text).toContain("10000 records");
		expect(text).toContain("Run the fast tier after every edit");
		expect(text).toContain("do not complete this todo");
	});

	it("reports the remaining budget", () => {
		const plan = parseValidationPlan(
			item({ validationPlan: { fast: "bun test fast", budgetMinutes: 90 } }),
		);
		const text = formatValidationContext(plan!, { elapsedMs: 12 * 60 * 1000 });
		expect(text).toContain("Time budget: 90m");
		expect(text).toContain("elapsed 12m");
		expect(text).toContain("remaining 1h 18m");
	});
});
