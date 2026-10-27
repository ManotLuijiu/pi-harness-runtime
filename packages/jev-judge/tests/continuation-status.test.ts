/**
 * Tests for the lifecycle of a continuation the harness dispatched.
 *
 * The status of the session says that the agent is working. It may only
 * say that while the turn really runs: a timer that clears the status
 * would claim that nothing runs any more.
 */

import { describe, it, expect } from "bun:test";
import { ContinuationGate } from "../src/continuation-status.js";

describe("a continuation that was dispatched", () => {
	it("is pending until the turn settles", () => {
		const gate = new ContinuationGate();
		expect(gate.pending).toBe(false);

		gate.begin();
		expect(gate.pending).toBe(true);

		expect(gate.settle()).toBe(true);
		expect(gate.pending).toBe(false);
	});

	it("clears the status only once", () => {
		const gate = new ContinuationGate();
		gate.begin();
		expect(gate.settle()).toBe(true);
		// A second settlement has nothing to clear: the status was already
		// cleared by the first one.
		expect(gate.settle()).toBe(false);
	});

	it("is not pending without a continuation", () => {
		const gate = new ContinuationGate();
		expect(gate.settle()).toBe(false);
		expect(gate.pending).toBe(false);
	});

	it("waits for a new continuation after a settlement", () => {
		const gate = new ContinuationGate();
		gate.begin();
		gate.settle();

		gate.begin();
		expect(gate.pending).toBe(true);
		expect(gate.settle()).toBe(true);
	});
});
