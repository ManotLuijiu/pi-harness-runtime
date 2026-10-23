/**
 * Tests for the validation tie-breaker - the typed verdict that decides
 * whether an item may count as done.
 */

import { describe, it, expect } from "bun:test";
import { tieBreakValidation, formatTieBreaker } from "../src/validation-tie-breaker.js";
import { summarizeValidationState } from "../src/validation-plan.js";
import type { TodoItem } from "../src/todo-provider.js";

const item: TodoItem = {
	id: 4,
	subject: "staged work",
	status: "in_progress",
	metadata: {
		validationPlan: {
			fast: { command: "bun test tests/fast" },
			full: { command: "bun test tests/full" },
			finalTierRequired: true,
		},
	},
};

const plan = {
	fast: { kind: "fast" as const, command: "bun test tests/fast" },
	full: { kind: "full" as const, command: "bun test tests/full" },
	finalTierRequired: true,
};

describe("tieBreakValidation", () => {
	it("reports no-plan for an item without a plan", () => {
		const state = summarizeValidationState(null, []);
		const verdict = tieBreakValidation({ id: 1, subject: "plain", status: "in_progress" }, state);
		expect(verdict.verdict).toBe("no-plan");
		expect(verdict.blocksCompletion).toBe(false);
	});

	it("blocks the completion while the final tier did not run", () => {
		const state = summarizeValidationState(plan, []);
		const verdict = tieBreakValidation(item, state);
		expect(verdict.verdict).toBe("final-tier-pending");
		expect(verdict.blocksCompletion).toBe(true);
		expect(verdict.reason).toContain("has not run");
	});

	it("blocks the completion when the final tier failed", () => {
		const state = summarizeValidationState(plan, [
			{ ts: "2026-10-24T00:00:00.000Z", tier: "full", status: "failed" },
		]);
		const verdict = tieBreakValidation(item, state);
		expect(verdict.verdict).toBe("final-tier-failed");
		expect(verdict.blocksCompletion).toBe(true);
		expect(verdict.tierStatus).toBe("failed");
	});

	it("allows the completion when the final tier passed", () => {
		const state = summarizeValidationState(plan, [
			{ ts: "2026-10-24T00:00:00.000Z", tier: "full", status: "passed" },
		]);
		const verdict = tieBreakValidation(item, state);
		expect(verdict.verdict).toBe("complete");
		expect(verdict.blocksCompletion).toBe(false);
	});

	it("allows the completion when no final tier is required", () => {
		const state = summarizeValidationState(
			{ fast: { kind: "fast", command: "bun test tests/fast" } },
			[],
		);
		const verdict = tieBreakValidation(item, state);
		expect(verdict.verdict).toBe("complete");
		expect(verdict.blocksCompletion).toBe(false);
	});

	it("flags a plan that requires a final tier but declares none", () => {
		const state = summarizeValidationState({ finalTierRequired: true }, []);
		const verdict = tieBreakValidation(item, state);
		expect(verdict.verdict).toBe("plan-incomplete");
		expect(verdict.blocksCompletion).toBe(true);
	});

	it("formats the verdict for a log line", () => {
		const state = summarizeValidationState(plan, []);
		const verdict = tieBreakValidation(item, state);
		expect(formatTieBreaker(verdict)).toContain("staged work");
		expect(formatTieBreaker(verdict)).toContain("final-tier-pending");
	});
});
