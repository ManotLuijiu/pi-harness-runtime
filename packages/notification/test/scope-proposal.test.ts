/**
 * The notification of a scope proposal.
 *
 * A proposal of a new scope needs an answer: the backlog is not work of the
 * request that finished, and it does not become work by silence. The
 * decision that follows is not a question: it needs no approval.
 */

import { describe, it, expect } from "bun:test";
import { formatDetailLines, isErrorEvent } from "../src/adapters/detail-format.js";
import { telegramStatusLabel } from "../src/adapters/telegram-adapter.js";
import {
	NotificationPolicyEngine,
	requiresApproval,
} from "../src/notification-policy.js";
import type { NotificationEvent } from "../src/types.js";

const proposalEvent: NotificationEvent = "ScopeProposal";
const decisionEvent: NotificationEvent = "ScopeDecision";

describe("the scope proposal event", () => {
	it("needs an approval and is not an error", () => {
		expect(requiresApproval(proposalEvent)).toBe(true);
		expect(isErrorEvent(proposalEvent)).toBe(false);
	});

	it("is never dropped by the policy of the package", () => {
		const engine = new NotificationPolicyEngine();
		const decision = engine.evaluate({ event: proposalEvent });
		expect(decision.shouldNotify).toBe(true);
		expect(decision.includeButtons).toBe(true);
	});

	it("has a status label of its own", () => {
		expect(telegramStatusLabel(proposalEvent)).toBe("[SCOPE]");
	});

	it("names the exact ids and the deadline", () => {
		const lines = formatDetailLines(
			{
				scopeIds: ["bd-1", "bd-2"],
				scopeDeadline: "2026-11-11T12:05:00.000Z",
			},
			proposalEvent,
		);
		expect(lines).toEqual([
			{ label: "Issues", value: "bd-1, bd-2" },
			{ label: "Deadline", value: "2026-11-11T12:05:00.000Z" },
		]);
		expect(lines.some((line) => line.label === "Error")).toBe(false);
	});

	it("does not render a missing fact", () => {
		expect(formatDetailLines({}, proposalEvent)).toEqual([]);
		expect(
			formatDetailLines({ scopeIds: ["", "bd-1"] }, proposalEvent),
		).toEqual([{ label: "Issues", value: "bd-1" }]);
	});
});

describe("the scope decision event", () => {
	it("needs no approval and is not an error", () => {
		expect(requiresApproval(decisionEvent)).toBe(false);
		expect(isErrorEvent(decisionEvent)).toBe(false);
	});

	it("has a status label of its own", () => {
		expect(telegramStatusLabel(decisionEvent)).toBe("[SCOPE]");
	});
});
