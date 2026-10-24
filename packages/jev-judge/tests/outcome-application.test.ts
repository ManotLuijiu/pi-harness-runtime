/**
 * The runtime must never continue the work on a stale Jev decision.
 *
 * A pending question is closed with the Jev decision before the work
 * continues. When the close fails the request was already answered by a
 * human, so the Jev decision is stale: it must be discarded.
 */

import { describe, it, expect } from "bun:test";
import { decideOutcomeApplication } from "../src/auto-continue.js";

describe("decideOutcomeApplication", () => {
	describe("a still-pending request", () => {
		it("continues the work on an approval", () => {
			expect(decideOutcomeApplication("approve", true)).toBe("continue");
		});

		it("continues the work on a cautious approval", () => {
			expect(decideOutcomeApplication("proceed_with_caution", true)).toBe("continue");
		});

		it("pauses the work on a rejection", () => {
			expect(decideOutcomeApplication("reject", true)).toBe("pause");
		});

		it("keeps the question open on a wait", () => {
			expect(decideOutcomeApplication("wait", true)).toBe("wait");
		});
	});

	describe("a request that was answered in the meantime", () => {
		it("discards an approval instead of overriding the human", () => {
			expect(decideOutcomeApplication("approve", false)).toBe("discard");
		});

		it("discards a cautious approval instead of overriding the human", () => {
			expect(decideOutcomeApplication("proceed_with_caution", false)).toBe("discard");
		});

		it("discards a rejection instead of overriding the human", () => {
			expect(decideOutcomeApplication("reject", false)).toBe("discard");
		});

		it("keeps a wait a wait", () => {
			expect(decideOutcomeApplication("wait", false)).toBe("wait");
		});
	});

	it("never continues the work on a rejection", () => {
		for (const closed of [true, false]) {
			expect(decideOutcomeApplication("reject", closed)).not.toBe("continue");
		}
	});
});
