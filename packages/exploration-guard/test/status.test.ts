import { describe, expect, test } from "bun:test";
import {
	explorationStatus,
	formatExplorationStatus,
} from "../src/status.js";
import { assessExploration } from "../src/budget.js";
import { createState } from "../src/state.js";
import type { ExplorationKey } from "../src/types.js";

const KEY: ExplorationKey = {
	workspace: "/home/frappe/project",
	sessionId: "session-1",
	generation: "gen-1",
	phase: "implementation",
};

function baseState() {
	return createState(KEY, 1000);
}

describe("the status of the exploration", () => {
	test("a fresh exploration is investigating", () => {
		const state = baseState();
		const status = explorationStatus(state, assessExploration(state));
		expect(status.outcome).toBe("investigating");
		expect(status.reads).toBe(0);
		expect(status.checkpointDue).toBe(false);
	});

	test("an intervention that needs a checkpoint shows it", () => {
		const state = baseState();
		state.readCount = 20;
		const status = explorationStatus(
			state,
			assessExploration(state, {
				readWarning: 1,
				readBudget: 10,
				stallWarning: 100,
				tokenWarning: 0,
				timeWarningMs: 0,
				repeatWarning: 3,
			}),
		);
		expect(status.outcome).toBe("checkpoint-due");
		expect(status.checkpointDue).toBe(true);
	});

	test("an intervention that suggests the change shows it", () => {
		const state = baseState();
		state.readCount = 20;
		state.checkpoint.findings.push({ statement: "the cause is known", at: 1000 });
		const status = explorationStatus(
			state,
			assessExploration(state, {
				readWarning: 1,
				readBudget: 10,
				stallWarning: 100,
				tokenWarning: 0,
				timeWarningMs: 0,
				repeatWarning: 3,
			}),
		);
		expect(status.outcome).toBe("implementation-started");
		expect(status.suggestsImplementation).toBe(true);
	});

	test("an open question without a decision means more investigation", () => {
		const state = baseState();
		state.checkpoint.openQuestions.push("where is the reset read?");
		const status = explorationStatus(state);
		expect(status.outcome).toBe("investigate-more");
	});
});

describe("the label of the exploration", () => {
	test("the label is compact and uses no emoji", () => {
		const state = baseState();
		state.readCount = 5;
		state.repeatCount = 2;
		const label = formatExplorationStatus(explorationStatus(state));
		expect(label).toBe("investigating | 5 reads | 2 repeats");
		expect(label).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
	});

	test("an estimated token count is marked as an estimate", () => {
		const state = baseState();
		state.estimatedTokens = 1200;
		state.estimatedTokensApproximate = true;
		const label = formatExplorationStatus(explorationStatus(state));
		expect(label).toContain("~1200 tokens");
	});

	test("a measured token count is not marked", () => {
		const state = baseState();
		state.estimatedTokens = 1200;
		state.estimatedTokensApproximate = false;
		const label = formatExplorationStatus(explorationStatus(state));
		expect(label).toContain("1200 tokens");
		expect(label).not.toContain("~1200");
	});

	test("a checkpoint that is due is named", () => {
		const label = formatExplorationStatus({
			outcome: "checkpoint-due",
			reads: 3,
			repeats: 0,
			checkpointDue: true,
			suggestsImplementation: false,
			estimatedTokensApproximate: true,
		});
		expect(label).toContain("checkpoint due");
	});

	test("a blocked exploration is named", () => {
		const label = formatExplorationStatus({
			outcome: "blocked",
			reads: 3,
			repeats: 0,
			checkpointDue: false,
			suggestsImplementation: false,
			estimatedTokensApproximate: true,
		});
		expect(label).toContain("blocked");
	});
});
