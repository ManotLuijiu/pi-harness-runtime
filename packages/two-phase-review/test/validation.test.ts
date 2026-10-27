/**
 * The validation gate of the workflow.
 *
 * The gate reads the result of the ledger. A gate that cannot be read is
 * never a gate that passed: the workflow must not report a test as done
 * because it does not know how it went.
 */

import { describe, it, expect } from "bun:test";
import {
	describeValidationGate,
	emptyValidationGateState,
	validationGateSatisfied,
} from "../src/validation.js";

describe("the validation gate", () => {
	it("is not satisfied when the state cannot be read", () => {
		const state = {
			...emptyValidationGateState(),
			reason: "the ledger is not initialized",
		};
		expect(validationGateSatisfied(state)).toBe(false);
		expect(describeValidationGate(state)).toMatch(/not readable/);
	});

	it("is satisfied when every required tier passed", () => {
		const state = {
			available: true,
			pendingFinalTier: 0,
			failedFinalTier: 0,
			incompletePlan: 0,
		};
		expect(validationGateSatisfied(state)).toBe(true);
		expect(describeValidationGate(state)).toBe("every required tier passed");
	});

	it("is not satisfied while a final tier is pending", () => {
		const state = {
			available: true,
			pendingFinalTier: 1,
			failedFinalTier: 0,
			incompletePlan: 0,
		};
		expect(validationGateSatisfied(state)).toBe(false);
		expect(describeValidationGate(state)).toMatch(/1 final tier\(s\) pending/);
	});

	it("is not satisfied when a final tier failed", () => {
		const state = {
			available: true,
			pendingFinalTier: 0,
			failedFinalTier: 1,
			incompletePlan: 0,
		};
		expect(validationGateSatisfied(state)).toBe(false);
		expect(describeValidationGate(state)).toMatch(/1 final tier\(s\) failed/);
	});

	it("is not satisfied when a plan requires a tier it does not declare", () => {
		const state = {
			available: true,
			pendingFinalTier: 0,
			failedFinalTier: 0,
			incompletePlan: 1,
		};
		expect(validationGateSatisfied(state)).toBe(false);
		expect(describeValidationGate(state)).toMatch(/without a final tier/);
	});
});
