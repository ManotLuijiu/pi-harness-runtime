/**
 * Notification detail formatting.
 *
 * A resume trigger ("provider-overload", "post-compact") is a reason, not an
 * error. It must never be rendered under the "Error:" footer, otherwise every
 * scheduled resume looks like a failure in the Telegram message.
 */

import { describe, it, expect } from "bun:test";
import {
	ERROR_EVENTS,
	formatDetailLines,
	isErrorEvent,
} from "../src/adapters/detail-format.js";
import { buildTelegramMessage } from "../src/adapters/telegram-adapter.js";
import type { NotificationEvent, NotificationPayload } from "../src/types.js";

function payload(
	event: NotificationEvent,
	details: Record<string, unknown>,
	message = "Job will resume work on: \"Session auto-resume\"",
): NotificationPayload {
	return {
		event,
		jobId: "job-1",
		timestamp: "2026-10-24T00:00:00.000Z",
		title: "Resume Scheduled",
		message,
		details: { jobId: "job-1", requirement: "Session auto-resume", ...details },
	};
}

describe("detail formatter", () => {
	it("renders a resume reason as a reason, not as an error", () => {
		const lines = formatDetailLines({ reason: "provider-overload" }, "ResumeScheduled");

		expect(lines).toEqual([{ label: "Reason", value: "provider-overload" }]);
		expect(lines.some((line) => line.label === "Error")).toBe(false);
	});

	it("renders a real error under the error label", () => {
		const lines = formatDetailLines({ error: "NullPointerException" }, "TaskFailed");

		expect(lines).toEqual([{ label: "Error", value: "NullPointerException" }]);
	});

	it("keeps a legacy error of a non error event readable as a reason", () => {
		const lines = formatDetailLines({ error: "Resumes at 12:00" }, "QuotaPaused");

		expect(lines).toEqual([{ label: "Reason", value: "Resumes at 12:00" }]);
	});

	it("knows which events are error events", () => {
		expect(isErrorEvent("TaskFailed")).toBe(true);
		expect(isErrorEvent("E2EFailed")).toBe(true);
		expect(isErrorEvent("Error")).toBe(true);
		expect(isErrorEvent("ResumeScheduled")).toBe(false);
		expect(isErrorEvent("QuotaPaused")).toBe(false);
		expect(isErrorEvent("ContextCompacted")).toBe(false);
		expect(ERROR_EVENTS.has("ResumeScheduled")).toBe(false);
	});

	it("ignores empty and non string details", () => {
		expect(formatDetailLines({ reason: "   " }, "ResumeScheduled")).toEqual([]);
		expect(formatDetailLines({ reason: 42 }, "ResumeScheduled")).toEqual([]);
		expect(formatDetailLines(undefined, "ResumeScheduled")).toEqual([]);
	});
});

describe("telegram message rendering", () => {
	it("shows the resume reason without an error footer", () => {
		const message = buildTelegramMessage(
			payload("ResumeScheduled", { reason: "post-compact" }),
		);

		expect(message).toContain("Reason: post-compact");
		expect(message).not.toContain("Error:");
	});

	it("shows the provider overload trigger without an error footer", () => {
		const message = buildTelegramMessage(
			payload("ResumeScheduled", { reason: "provider-overload" }),
		);

		expect(message).toContain("Reason: provider-overload");
		expect(message).not.toContain("Error:");
	});

	it("still renders a real failure as an error", () => {
		const message = buildTelegramMessage(
			payload("TaskFailed", { error: "NullPointerException" }, "Task \"Fix login\" failed"),
		);

		expect(message).toContain("Error: NullPointerException");
		expect(message).not.toContain("Reason:");
	});

	it("keeps the legacy error of a resume event out of the error footer", () => {
		const message = buildTelegramMessage(
			payload("ResumeScheduled", { error: "provider-overload" }),
		);

		expect(message).not.toContain("Error:");
		expect(message).toContain("Reason: provider-overload");
	});
});
