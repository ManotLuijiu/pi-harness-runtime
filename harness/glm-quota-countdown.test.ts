/**
 * GLM Quota Countdown Tests
 *
 * Run with: bun test harness/glm-quota-countdown.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
	parseGLMResetTime,
	formatCountdown,
	GLMQuotaCountdown,
} from "./glm-quota-countdown.js";

describe("parseGLMResetTime", () => {
	it("parses full datetime format 'reset at 2026-08-25 01:47:16'", () => {
		const result = parseGLMResetTime(
			'Error: 429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-08-25 01:47:16"}',
		);
		expect(result).not.toBeNull();
		const date = new Date(result!);
		expect(date.getUTCFullYear()).toBe(2026);
		expect(date.getUTCMonth()).toBe(7); // August is 7 (0-indexed)
		expect(date.getUTCDate()).toBe(25);
	});

	it("parses full datetime format with T separator", () => {
		const result = parseGLMResetTime(
			"Your limit will reset at 2026-08-25T01:47:16",
		);
		expect(result).not.toBeNull();
		const date = new Date(result!);
		expect(date.getUTCFullYear()).toBe(2026);
	});

	it("parses time-only format when date is implied", () => {
		const result = parseGLMResetTime("will reset at 14:30:00");
		expect(result).not.toBeNull();
		const date = new Date(result!);
		expect(date.getUTCHours()).toBe(14);
		expect(date.getUTCMinutes()).toBe(30);
	});

	it("returns null for non-GLM messages", () => {
		expect(parseGLMResetTime("Hello world")).toBeNull();
		expect(parseGLMResetTime("OpenAI rate limit exceeded")).toBeNull();
	});

	it("handles GLM error with code 1308", () => {
		const result = parseGLMResetTime(
			'{"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-08-25 01:47:16"}',
		);
		expect(result).not.toBeNull();
	});

	it("parses alternative format 'reset at 2026-08-25 01:47:16'", () => {
		const result = parseGLMResetTime(
			"reset at 2026-08-25 01:47:16 - please retry later",
		);
		expect(result).not.toBeNull();
	});
});

describe("formatCountdown", () => {
	it("formats days, hours, minutes, seconds", () => {
		expect(formatCountdown(90061)).toBe("1d 1h 1m 1s"); // 1 day, 1 hour, 1 min, 1 sec
	});

	it("formats hours and minutes when no days", () => {
		expect(formatCountdown(3661)).toBe("1h 1m 1s");
	});

	it("formats minutes and seconds when no hours", () => {
		expect(formatCountdown(125)).toBe("2m 5s");
	});

	it("formats seconds only when less than a minute", () => {
		expect(formatCountdown(45)).toBe("45s");
	});

	it("returns 'RESET NOW' for zero or negative", () => {
		expect(formatCountdown(0)).toBe("RESET NOW");
		expect(formatCountdown(-100)).toBe("RESET NOW");
	});

	it("handles exactly 24 hours", () => {
		expect(formatCountdown(86400)).toBe("1d 0h 0m 0s");
	});

	it("handles exactly 1 hour", () => {
		expect(formatCountdown(3600)).toBe("1h 0m 0s");
	});

	it("handles exactly 1 minute", () => {
		expect(formatCountdown(60)).toBe("1m 0s");
	});
});

describe("GLMQuotaCountdown", () => {
	let countdown: GLMQuotaCountdown;
	let mockCheckpoint: any;
	let mockTransition: any;
	let mockReadProvider: any;

	beforeEach(() => {
		countdown = new GLMQuotaCountdown();

		// Track calls for verification
		mockCheckpoint = { jobId: "test-job", status: "paused_quota" };
		mockTransition = { success: true };
		mockReadProvider = null;
	});

	afterEach(() => {
		countdown.dispose();
	});

	describe("hasCountdown / getCountdown", () => {
		it("returns false initially for unknown job", () => {
			expect(countdown.hasCountdown("unknown")).toBe(false);
			expect(countdown.getCountdown("unknown")).toBeNull();
		});
	});

	describe("startCountdown", () => {
		it("starts countdown and stores state", async () => {
			const futureDate = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			const mockMirror = createMockMirror(() => mockReadProvider, noopWrite);

			const state = await countdown.startCountdown(
				"job-1",
				futureDate,
				mockMirror,
				mockMachine,
			);

			expect(state.jobId).toBe("job-1");
			expect(state.resetAt).toBe(futureDate);
			expect(state.totalSeconds).toBeGreaterThan(3500); // ~1 hour
			expect(countdown.hasCountdown("job-1")).toBe(true);
		});

		it("cancels existing countdown before starting new one", async () => {
			const futureDate1 = new Date(Date.now() + 3600000).toISOString();
			const futureDate2 = new Date(Date.now() + 7200000).toISOString();
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			const mockMirror = createMockMirror(() => mockReadProvider, noopWrite);

			await countdown.startCountdown(
				"job-1",
				futureDate1,
				mockMirror,
				mockMachine,
			);

			const state = await countdown.startCountdown(
				"job-1",
				futureDate2,
				mockMirror,
				mockMachine,
			);

			// Should have only one countdown
			expect(countdown.getAllCountdowns().length).toBe(1);
			expect(state.resetAt).toBe(futureDate2);
		});

		it("updates mirror store with reset time", async () => {
			const futureDate = new Date(Date.now() + 3600000).toISOString();
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			let capturedRecord: any = null;
			const mockMirror = createMockMirror(
				() => mockReadProvider,
				(_p, r) => {
					capturedRecord = r;
				},
			);

			await countdown.startCountdown("job-1", futureDate, mockMirror, mockMachine);

			expect(capturedRecord).not.toBeNull();
			expect(capturedRecord.provider).toBe("glm");
			expect(capturedRecord.exhausted).toBe(true);
			expect(capturedRecord.h5_resets_at).toBe(futureDate);
		});
	});

	describe("startFromError", () => {
		it("parses reset time from error message", async () => {
			const errorMsg =
				'Error: 429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2099-12-31 23:59:59"}';
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			const mockMirror = createMockMirror(() => mockReadProvider, noopWrite);

			const state = await countdown.startFromError(
				"job-1",
				errorMsg,
				mockMirror,
				mockMachine,
			);

			expect(state).not.toBeNull();
			expect(state!.jobId).toBe("job-1");
			expect(countdown.hasCountdown("job-1")).toBe(true);
		});

		it("returns null when reset time cannot be parsed", async () => {
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			const mockMirror = createMockMirror(() => mockReadProvider, noopWrite);

			const state = await countdown.startFromError(
				"job-1",
				"Some unrelated error message",
				mockMirror,
				mockMachine,
			);

			expect(state).toBeNull();
		});
	});

	describe("cancelCountdown", () => {
		it("cancels active countdown", async () => {
			const futureDate = new Date(Date.now() + 3600000).toISOString();
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			const mockMirror = createMockMirror(() => mockReadProvider, noopWrite);

			await countdown.startCountdown("job-1", futureDate, mockMirror, mockMachine);

			expect(countdown.hasCountdown("job-1")).toBe(true);

			countdown.cancelCountdown("job-1");

			expect(countdown.hasCountdown("job-1")).toBe(false);
		});

		it("handles cancelling non-existent countdown", () => {
			// Should not throw
			expect(() => countdown.cancelCountdown("non-existent")).not.toThrow();
		});
	});

	describe("onTick callback", () => {
		it("receives tick events", async () => {
			const ticks: any[] = [];
			const futureDate = new Date(Date.now() + 3600000).toISOString();
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			const mockMirror = createMockMirror(() => mockReadProvider, noopWrite);

			const unsubscribe = countdown.onTick((event) => {
				ticks.push(event);
			});

			await countdown.startCountdown("job-1", futureDate, mockMirror, mockMachine);

			// Wait a bit for initial tick
			await new Promise((r) => setTimeout(r, 100));

			expect(ticks.length).toBeGreaterThan(0);
			expect(ticks[0].jobId).toBe("job-1");
			expect(ticks[0].remainingFormatted).toBeDefined();

			unsubscribe();
		});
	});

	describe("getAllCountdowns", () => {
		it("returns all active countdowns", async () => {
			const futureDate = new Date(Date.now() + 3600000).toISOString();
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			const mockMirror = createMockMirror(() => mockReadProvider, noopWrite);

			await countdown.startCountdown("job-1", futureDate, mockMirror, mockMachine);

			await countdown.startCountdown("job-2", futureDate, mockMirror, mockMachine);

			const all = countdown.getAllCountdowns();
			expect(all.length).toBe(2);
			expect(all.map((c) => c.jobId)).toContain("job-1");
			expect(all.map((c) => c.jobId)).toContain("job-2");
		});
	});

	describe("dispose", () => {
		it("clears all timers and countdowns", async () => {
			const futureDate = new Date(Date.now() + 3600000).toISOString();
			const mockMachine = createMockMachine(mockCheckpoint, mockTransition);
			const mockMirror = createMockMirror(() => mockReadProvider, noopWrite);

			await countdown.startCountdown("job-1", futureDate, mockMirror, mockMachine);

			await countdown.startCountdown("job-2", futureDate, mockMirror, mockMachine);

			expect(countdown.getAllCountdowns().length).toBe(2);

			countdown.dispose();

			expect(countdown.getAllCountdowns().length).toBe(0);
		});
	});
});

// No-op write function for tests that don't need to verify write calls
function noopWrite(_provider: string, _record: any): void {}

// Helper: Create mock JobStateMachine
function createMockMachine(getCheckpointResult: any, transitionResult: any) {
	return {
		getCheckpoint: () => getCheckpointResult,
		transition: async () => transitionResult,
	} as any;
}

// Helper: Create mock MirrorStore
function createMockMirror(
	readProviderFn: () => any,
	writeProviderFn: (provider: string, record: any) => void,
) {
	return {
		readProvider: readProviderFn,
		writeProvider: writeProviderFn,
	} as any;
}
