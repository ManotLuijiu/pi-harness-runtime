/**
 * The notification of a low quota allowance.
 *
 * The event is not a failure and not a decision: it needs no approval and
 * it renders the allowance of a window as a fact, never under an "Error:"
 * label.
 */

import { describe, it, expect } from "bun:test";
import { formatDetailLines, isErrorEvent } from "../src/adapters/detail-format.js";
import { telegramStatusLabel } from "../src/adapters/telegram-adapter.js";
import { requiresApproval } from "../src/notification-policy.js";
import type { NotificationEvent } from "../src/types.js";

const event: NotificationEvent = "QuotaLowRemaining";

describe("the quota low remaining event", () => {
	it("is not an error event and needs no approval", () => {
		expect(isErrorEvent(event)).toBe(false);
		expect(requiresApproval(event)).toBe(false);
	});

	it("has a status label of its own", () => {
		expect(telegramStatusLabel(event)).toBe("[QUOTA]");
	});

	it("renders the allowance as a fact, never as an error", () => {
		const lines = formatDetailLines(
			{
				provider: "MiniMax",
				quotaWindow: "5h",
				remainingPct: 9.9,
				resetAt: "2026-11-11T12:00:00.000Z",
			},
			event,
		);
		expect(lines).toEqual([
			{ label: "Provider", value: "MiniMax" },
			{ label: "Window", value: "5h" },
			{ label: "Remaining", value: "9.9%" },
			{ label: "Resets", value: "2026-11-11T12:00:00.000Z" },
		]);
		expect(lines.some((line) => line.label === "Error")).toBe(false);
	});

	it("does not render a missing fact", () => {
		const lines = formatDetailLines({ provider: "MiniMax" }, event);
		expect(lines).toEqual([{ label: "Provider", value: "MiniMax" }]);
	});
});
