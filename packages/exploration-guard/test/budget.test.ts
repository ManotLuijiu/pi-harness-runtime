import { describe, expect, test } from "bun:test";
import {
	assessExploration,
	classifyRepeat,
	DEFAULT_EXPLORATION_BUDGET,
	hasSubstantiveProgress,
	rangeCovered,
	readsSinceNarrowing,
} from "../src/budget.js";
import { createState, ensureCoverage } from "../src/state.js";
import type { ExplorationBudget, ExplorationKey } from "../src/types.js";

const KEY: ExplorationKey = {
	workspace: "/home/frappe/project",
	sessionId: "session-1",
	generation: "gen-1",
	phase: "implementation",
};

const TIGHT: ExplorationBudget = {
	readWarning: 3,
	readBudget: 10,
	stallWarning: 4,
	tokenWarning: 1000,
	timeWarningMs: 60_000,
	repeatWarning: 2,
};

function baseState() {
	return createState(KEY, 1000);
}

describe("the coverage of a range", () => {
	test("a range inside a covered range is covered", () => {
		expect(
			rangeCovered([{ start: 1, end: 100 }], { start: 10, end: 20 }),
		).toBe(true);
	});

	test("a range that reaches beyond a covered range is not covered", () => {
		expect(
			rangeCovered([{ start: 1, end: 100 }], { start: 90, end: 200 }),
		).toBe(false);
	});

	test("a truncated range covers only its own part", () => {
		expect(
			rangeCovered([{ start: 1, end: 50, truncated: true }], { start: 40, end: 80 }),
		).toBe(false);
		expect(
			rangeCovered([{ start: 1, end: 50, truncated: true }], { start: 10, end: 20 }),
		).toBe(true);
	});
});

describe("the classification of a repeat", () => {
	test("a read of a covered range is a repeat", () => {
		const coverage = ensureCoverage([], "src/a.ts");
		coverage.ranges.push({ start: 1, end: 100 });
		expect(classifyRepeat(coverage, { start: 10, end: 20 })).toBe("repeat");
	});

	test("a read of a new range is not a repeat", () => {
		const coverage = ensureCoverage([], "src/a.ts");
		coverage.ranges.push({ start: 1, end: 100 });
		expect(classifyRepeat(coverage, { start: 101, end: 200 })).toBe("new");
	});

	test("a read without a range is unknown", () => {
		const coverage = ensureCoverage([], "src/a.ts");
		expect(classifyRepeat(coverage, undefined)).toBe("unknown");
	});
});

describe("the decision of the guard", () => {
	test("a fresh exploration says nothing", () => {
		const decision = assessExploration(baseState(), TIGHT);
		expect(decision.kind).toBe("none");
		expect(decision.message).toBe("");
		expect(decision.requiresCheckpoint).toBe(false);
	});

	test("a repeated read of one range is reported", () => {
		const state = baseState();
		const coverage = ensureCoverage(state.files, "src/a.ts");
		coverage.readCount = 3;
		coverage.repeatCount = 3;
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("repeat-read");
		expect(decision.paths).toContain("src/a.ts");
		expect(decision.requiresCheckpoint).toBe(true);
	});

	test("a long run of reads without a narrowing is reported", () => {
		const state = baseState();
		state.readCount = 6;
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("stall");
		expect(decision.requiresCheckpoint).toBe(true);
	});

	test("a recorded narrowing ends the stall", () => {
		const state = baseState();
		state.readCount = 6;
		state.checkpoint.findings.push({
			statement: "the reset happens in the provider",
			at: 1000,
		});
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).not.toBe("stall");
		expect(hasSubstantiveProgress(state)).toBe(true);
	});

	test("the read budget asks for a checkpoint and for the change", () => {
		const state = baseState();
		state.readCount = 12;
		state.checkpoint.findings.push({ statement: "x", at: 1000 });
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("read-budget");
		expect(decision.requiresCheckpoint).toBe(true);
		expect(decision.suggestsImplementation).toBe(true);
	});

	test("the read budget wins over the stall", () => {
		// The reads reached the budget and there is no narrowing: the stall
		// is true, but the budget is the stronger fact. The guard says the
		// strongest thing it knows.
		const state = baseState();
		state.readCount = 12;
		const decision = assessExploration(state, TIGHT);
		expect(readsSinceNarrowing(state)).toBeGreaterThanOrEqual(
			TIGHT.stallWarning,
		);
		expect(decision.kind).toBe("read-budget");
		expect(decision.suggestsImplementation).toBe(true);
	});

	test("the token budget wins over the stall", () => {
		const state = baseState();
		state.readCount = 6;
		state.estimatedTokens = 5000;
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("token-budget");
	});

	test("the time budget wins over the stall", () => {
		const state = baseState();
		state.readCount = 6;
		state.explorationTimeMs = 90_000;
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("time-budget");
	});

	test("the read budget wins over the repeat of a read", () => {
		// The reads reached the budget and one file was read again. The
		// budget is the stronger fact: the agent has to hear that the
		// budget is reached, not that a file was read twice.
		const state = baseState();
		state.readCount = 12;
		const coverage = ensureCoverage(state.files, "src/a.ts");
		coverage.readCount = 3;
		coverage.repeatCount = 3;
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("read-budget");
		expect(decision.suggestsImplementation).toBe(true);
	});

	test("the token budget wins over the repeat of a read", () => {
		const state = baseState();
		state.readCount = 6;
		state.estimatedTokens = 5000;
		const coverage = ensureCoverage(state.files, "src/a.ts");
		coverage.readCount = 3;
		coverage.repeatCount = 3;
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("token-budget");
	});

	test("the repeat of a read is told before the stall", () => {
		const state = baseState();
		state.readCount = 6;
		const coverage = ensureCoverage(state.files, "src/a.ts");
		coverage.readCount = 3;
		coverage.repeatCount = 3;
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("repeat-read");
	});

	test("the token budget is reached", () => {
		const state = baseState();
		state.readCount = 1;
		state.estimatedTokens = 5000;
		state.checkpoint.findings.push({ statement: "x", at: 1000 });
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("token-budget");
	});

	test("the time budget is reached", () => {
		const state = baseState();
		state.readCount = 1;
		state.explorationTimeMs = 90_000;
		state.checkpoint.findings.push({ statement: "x", at: 1000 });
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("time-budget");
	});

	test("the warning of the read count does not require a checkpoint", () => {
		const state = baseState();
		state.readCount = 4;
		state.checkpoint.findings.push({ statement: "x", at: 1000 });
		const decision = assessExploration(state, TIGHT);
		expect(decision.kind).toBe("none");
		expect(decision.requiresCheckpoint).toBe(false);
		expect(decision.message.length).toBeGreaterThan(0);
	});

	test("the default budget never blocks", () => {
		const state = baseState();
		state.readCount = 10_000;
		const decision = assessExploration(state, DEFAULT_EXPLORATION_BUDGET);
		expect(decision.kind).not.toBe("blocked");
	});
});

describe("the reads since the last narrowing", () => {
	test("a fresh exploration has no narrowing", () => {
		expect(readsSinceNarrowing(baseState())).toBe(0);
	});

	test("a recorded finding lowers the count", () => {
		const state = baseState();
		state.readCount = 10;
		state.checkpoint.findings.push({ statement: "x", at: 1000 });
		expect(readsSinceNarrowing(state)).toBe(9);
	});
});
