/**
 * Surge auto-resume tests — S2/S4 acceptance (wiki/peak-hour-surge-auto-resume.md)
 *
 * All deterministic via injected sleep/rand — no real timers, no API keys.
 *
 * Run:
 *   bun test harness/langchain/surge.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import {
	classifySurge,
	computeSurgeDelayMs,
	invokeWithSurgeRetry,
	SurgeScheduler,
	type SurgePolicy,
} from "./surge.js";
import type { LoopDeps } from "./graph.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** The exact incident message from the amos-saas E2E failure (2026-08-31). */
const INCIDENT =
	'529 {"type":"error","error":{"type":"overloaded_error","message":"The system is currently experiencing a peak-hour surge, and the server is temporarily busy. It usually recovers within 1–5 minutes. Please try again shortly (2064)"},"request_id":"06e405e2e5965672576925264941a057"}';

const SIGNAL_3MIN = {
	retryAfterMs: 180_000,
	explicit: true,
	sourceText: INCIDENT,
};

const FAST_POLICY: Partial<SurgePolicy> = {
	baseDelayMs: 100,
	multiplier: 2,
	minDelayMs: 10,
	maxDelayMs: 1_000,
	jitterRatio: 0,
	maxAttempts: 3,
};

// ─── T1 Classification ───────────────────────────────────────────────────────

describe("T1 — classifySurge", () => {
	it("classifies the incident message (midpoint of 1–5 min = 3 min)", () => {
		const sig = classifySurge(new Error(INCIDENT));
		assert.ok(sig, "should classify");
		assert.equal(sig?.retryAfterMs, 180_000);
		assert.equal(sig?.explicit, true);
	});

	it("classifies plain 529 status", () => {
		const sig = classifySurge(new Error("HTTP 529"));
		assert.ok(sig);
		assert.equal(sig?.explicit, false); // no stated delay → 2 min default
		assert.equal(sig?.retryAfterMs, 120_000);
	});

	it("parses 'retry after 30 seconds'", () => {
		const sig = classifySurge(
			new Error("overloaded — please retry after 30 seconds"),
		);
		assert.ok(sig);
		assert.equal(sig?.retryAfterMs, 30_000);
	});

	it("parses retry-after milliseconds", () => {
		const sig = classifySurge(new Error("529; retry-after: 45000ms"));
		assert.ok(sig);
		assert.equal(sig?.retryAfterMs, 45_000);
	});

	it("rejects non-surge errors", () => {
		assert.equal(classifySurge(new Error("429 too many requests")), null);
		assert.equal(classifySurge(new Error("ECONNREFUSED")), null);
		assert.equal(classifySurge("file not found"), null);
	});
});

// ─── T2/T3 Delay computation & escalation ────────────────────────────────────

describe("T2 — computeSurgeDelayMs escalation", () => {
	it("escalates 3 → 6 → 12 min and caps at max", () => {
		const p = { jitterRatio: 0 } as const; // deterministic
		assert.equal(computeSurgeDelayMs(SIGNAL_3MIN, 1, p), 180_000);
		assert.equal(computeSurgeDelayMs(SIGNAL_3MIN, 2, p), 360_000);
		assert.equal(computeSurgeDelayMs(SIGNAL_3MIN, 3, p), 720_000);
		assert.equal(computeSurgeDelayMs(SIGNAL_3MIN, 9, p), 900_000); // 15 min cap
	});

	it("floors at minDelayMs (never hammer)", () => {
		const d = computeSurgeDelayMs({ ...SIGNAL_3MIN, retryAfterMs: 1_000 }, 1, {
			minDelayMs: 30_000,
			jitterRatio: 0,
		});
		assert.equal(d, 30_000);
	});

	it("jitter stays inside ±ratio and within bounds", () => {
		const lo = computeSurgeDelayMs(SIGNAL_3MIN, 1, { jitterRatio: 0.2 }, 0);
		const hi = computeSurgeDelayMs(SIGNAL_3MIN, 1, { jitterRatio: 0.2 }, 1);
		assert.ok(lo >= 180_000 * 0.8 && lo < 180_000);
		assert.ok(hi > 180_000 && hi <= 180_000 * 1.2);
	});
});

describe("T3 — SurgeScheduler attempt cap", () => {
	it("counts 1..maxAttempts then null", () => {
		const s = new SurgeScheduler({ maxAttempts: 3 });
		assert.equal(s.nextAttempt(), 1);
		assert.equal(s.nextAttempt(), 2);
		assert.equal(s.nextAttempt(), 3);
		assert.equal(s.nextAttempt(), null);
		assert.equal(s.attempts, 3);
	});
});

// ─── T-surge-retry Wrapper behavior ─────────────────────────────────────────

describe("invokeWithSurgeRetry", () => {
	it("retries through a 529 and succeeds (the incident scenario)", async () => {
		const sleeps: number[] = [];
		let calls = 0;
		const result = await invokeWithSurgeRetry(
			async () => {
				calls += 1;
				if (calls < 3) throw new Error(INCIDENT);
				return "approved";
			},
			{ policy: FAST_POLICY, sleep: async (ms) => void sleeps.push(ms) },
		);
		assert.equal(result, "approved");
		assert.equal(calls, 3);
		assert.deepEqual(sleeps, [100, 200]); // escalated, no jitter
	});

	it("rethrows non-surge errors immediately (no retry)", async () => {
		const sleeps: number[] = [];
		let calls = 0;
		await assert.rejects(
			invokeWithSurgeRetry(
				async () => {
					calls += 1;
					throw new Error("ECONNREFUSED");
				},
				{ policy: FAST_POLICY, sleep: async (ms) => void sleeps.push(ms) },
			),
			/ECONNREFUSED/,
		);
		assert.equal(calls, 1);
		assert.equal(sleeps.length, 0);
	});

	it("gives up after maxAttempts, fires onExhausted, rethrows last error", async () => {
		const pauses: number[] = [];
		let exhausted = false;
		let calls = 0;
		await assert.rejects(
			invokeWithSurgeRetry(
				async () => {
					calls += 1;
					throw new Error(INCIDENT);
				},
				{
					policy: FAST_POLICY,
					sleep: async (ms) => void pauses.push(ms),
					onSurge: ({ attempt }) => assert.ok(attempt >= 1 && attempt <= 3),
					onExhausted: () => {
						exhausted = true;
					},
				},
			),
			/overloaded_error/,
		);
		assert.equal(calls, 4); // initial + 3 retries
		assert.deepEqual(pauses, [100, 200, 400]);
		assert.equal(exhausted, true);
	});
});

// ─── T8 Daemon-level: graph deps that surge once, then succeed ───────────────

describe("T8 — loop deps surviving a mid-graph 529", () => {
	it("writeStep throws the incident once; retry wrapper completes the loop", async () => {
		const { buildWriteReviewLoop, buildDryRunDeps } = await import("./graph.js");

		const base = buildDryRunDeps({ maxIterations: 1 });
		let writeCalls = 0;
		const deps: LoopDeps = {
			...base,
			write: async (plan, review) => {
				writeCalls += 1;
				if (writeCalls === 1) throw new Error(INCIDENT);
				return base.write(plan, review);
			},
		};

		const loop = buildWriteReviewLoop(deps);
		const sleeps: number[] = [];
		const state = await invokeWithSurgeRetry(
			() =>
				loop.invoke(
					{ request: "surge survival test" },
					{ configurable: { thread_id: "t8-surge" } },
				),
			{ policy: FAST_POLICY, sleep: async (ms) => void sleeps.push(ms) },
		);

		assert.equal(writeCalls, 2); // first surged, retry succeeded
		assert.ok(state.review, "loop produced a review");
		assert.deepEqual(sleeps, [100]);
	});
});

// ─── GLM Quota Tests ─────────────────────────────────────────────────────────

import { classifyGLMQuota, invokeWithGLMRetry } from "./surge.js";

describe("classifyGLMQuota", () => {
	// The dates in the error messages are in the past (2026-09-04).
	// classifyGLMQuota shifts them to the NEXT occurrence (+1 day).
	// The tests verify: shift happened + time preserved verbatim.
	it("parses GLM 1308 error with reset timestamp", () => {
		const err = new Error(
			'429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-04 20:29:24"}',
		);
		const sig = classifyGLMQuota(err);
		assert.ok(sig, "should be classified as GLM quota");
		// 2026-09-04 is past → shifted to 2026-09-05; epoch must be in the future
		assert.ok(sig!.resetAtEpoch > Date.now(), "resetAtEpoch is in the future");
		assert.ok(sig!.resetAt.includes("2026-09-05"), "date shifted to next occurrence");
		assert.ok(sig!.resetAt.includes("20:29:24"), "time preserved verbatim");
	});

	it("parses 1308 from plain string error", () => {
		const err =
			'{"code":"1308","message":"Usage limit reached. Your limit will reset at 2026-09-04 20:29:24"}';
		const sig = classifyGLMQuota(err);
		assert.ok(sig, "should be classified as GLM quota");
		// space separator → normalised to T; past date → shifted to next occurrence
		assert.ok(sig!.resetAt.includes("2026-09-05"), "space normalised and date shifted");
	});

	it("parses reset time with T separator", () => {
		const err = new Error(
			'{"code":"1308","message":"Usage limit reached. Your limit will reset at 2026-09-04T20:29:24"}',
		);
		const sig = classifyGLMQuota(err);
		assert.ok(sig, "should be classified as GLM quota");
		// past date → next occurrence (2026-09-05); T separator preserved verbatim
		assert.ok(sig!.resetAt.includes("2026-09-05"), "date shifted to next occurrence");
		assert.ok(sig!.resetAt.includes("T"), "T separator preserved verbatim");
		assert.ok(sig!.resetAt.includes("20:29:24"), "time preserved verbatim");
	});

	it("returns null for non-GLM errors", () => {
		const err = new Error("529: overloaded error");
		assert.equal(classifyGLMQuota(err), null);
	});

	it("returns null for plain errors without 1308", () => {
		const err = new Error("Something went wrong");
		assert.equal(classifyGLMQuota(err), null);
	});

	it("1308 without reset time uses 5-min fallback", () => {
		const err = new Error('{"code":"1308","message":"Usage limit reached"}');
		const sig = classifyGLMQuota(err);
		assert.ok(sig, "should be classified");
		const diffMs = sig!.resetAtEpoch - Date.now();
		// Should be approximately 5 minutes
		assert.ok(diffMs >= 4 * 60_000 && diffMs <= 6 * 60_000, "5-min fallback");
	});
});

describe("invokeWithGLMRetry", () => {
	it("succeeds immediately when fn succeeds", async () => {
		const result = await invokeWithGLMRetry(() => Promise.resolve("ok"));
		assert.equal(result, "ok");
	});

	it("throws non-GLM errors immediately", async () => {
		await assert.rejects(
			() =>
				invokeWithGLMRetry(() => {
					throw new Error("not a GLM error");
				}),
			/not a GLM error/,
		);
	});

	it("waits until reset time before retry", async () => {
		const sleeps: number[] = [];
		const sleep = async (ms: number) => void sleeps.push(ms);
		// Use a reset time 100ms in the future
		const resetIn = 100;
		const resetAt = new Date(Date.now() + resetIn).toISOString();

		let attempts = 0;
		const result = await invokeWithGLMRetry(
			async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error(
						`{"code":"1308","message":"Usage limit. Reset at ${resetAt}"}`,
					);
				}
				return "success after retry";
			},
			{ sleep, tickMs: 10 },
		);

		assert.equal(result, "success after retry");
		assert.equal(attempts, 2, "retried after wait");
		assert.ok(sleeps.length >= 1, "slept at least once during countdown");
		assert.ok(
			sleeps.every((ms) => ms === 10),
			"tick interval used",
		);
	});

	it("fires onGLMQuota callback during countdown", async () => {
		const ticks: string[] = [];
		const sleep = async (ms: number) => void ticks.push(`sleep:${ms}`);
		const resetAt = new Date(Date.now() + 50).toISOString();

		let attempts = 0;
		await invokeWithGLMRetry(
			async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error(
						`{"code":"1308","message":"Usage limit. Reset at ${resetAt}"}`,
					);
				}
				return "done";
			},
			{
				sleep,
				tickMs: 10,
				onGLMQuota: (sig) => ticks.push(`quota:${sig.resetAtEpoch}`),
			},
		);

		assert.ok(
			ticks.some((t) => t.startsWith("quota:")),
			"onGLMQuota was called at least once",
		);
	});

	it("fires onGLMRetry callback after countdown expires", async () => {
		const events: string[] = [];
		const sleep = async (_ms: number) => void null;
		const resetAt = new Date(Date.now() + 20).toISOString();

		let attempts = 0;
		await invokeWithGLMRetry(
			async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error(
						`{"code":"1308","message":"Usage limit. Reset at ${resetAt}"}`,
					);
				}
				return "done";
			},
			{
				sleep,
				tickMs: 10,
				onGLMQuota: () => events.push("quota"),
				onGLMRetry: () => events.push("retry"),
			},
		);

		assert.ok(events.includes("quota"), "quota fired");
		assert.ok(events.includes("retry"), "retry fired");
		// retry fires AFTER quota
		assert.ok(
			events.indexOf("retry") > events.indexOf("quota"),
			"retry after quota",
		);
	});
});
