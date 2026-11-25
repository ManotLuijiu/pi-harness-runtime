import { test } from "node:test";
import assert from "node:assert/strict";
import {
	QUOTA_CAPTURE_REUSE_MS,
	QuotaCaptureController,
} from "../harness/quota-capture.ts";

const now = 1_700_000_000_000;

test("a capture refreshes the quota and remembers that it worked", async () => {
	const calls = [];
	const controller = new QuotaCaptureController({
		capture: async (provider) => {
			calls.push(provider);
			return true;
		},
		now: () => now,
	});
	controller.begin("MiniMax");
	await controller.wait();
	assert.deepEqual(calls, ["minimax"]);
	assert.equal(controller.failed("minimax"), false);
	assert.equal(controller.failed("openai"), false);
	assert.equal(controller.outcome.provider, "minimax");
	assert.equal(controller.outcome.ok, true);
});

test("a capture that fails is remembered as a failure", async () => {
	const controller = new QuotaCaptureController({
		capture: async () => false,
		now: () => now,
	});
	controller.begin("minimax");
	await controller.wait();
	assert.equal(controller.failed("minimax"), true);
	// Another provider keeps its own state.
	assert.equal(controller.failed("openai"), false);
});

test("a capture that throws is a failed capture, not a crash", async () => {
	const logs = [];
	const controller = new QuotaCaptureController({
		capture: async () => {
			throw new Error("the browser is gone");
		},
		now: () => now,
		log: (message) => logs.push(message),
	});
	controller.begin("minimax");
	await controller.wait();
	assert.equal(controller.failed("minimax"), true);
	assert.equal(logs.length, 1);
	assert.match(logs[0], /the browser is gone/);
});

test("a capture of the same provider is not repeated", async () => {
	let calls = 0;
	const controller = new QuotaCaptureController({
		capture: async () => {
			calls += 1;
			return true;
		},
		now: () => now,
	});
	controller.begin("minimax");
	await controller.wait();
	controller.begin("minimax");
	await controller.wait();
	assert.equal(calls, 1);
});

test("a capture is repeated when the row of the mirror is old", async () => {
	let calls = 0;
	let clock = now;
	const controller = new QuotaCaptureController({
		capture: async () => {
			calls += 1;
			return true;
		},
		now: () => clock,
	});
	controller.begin("minimax");
	await controller.wait();
	clock = now + QUOTA_CAPTURE_REUSE_MS + 1;
	controller.begin("minimax");
	await controller.wait();
	assert.equal(calls, 2);
});

test("waiting without a capture returns at once", async () => {
	const controller = new QuotaCaptureController({
		capture: async () => true,
		now: () => now,
	});
	await controller.wait();
	assert.equal(controller.outcome, null);
});

test("the outcome of one provider does not answer for another one", async () => {
	const controller = new QuotaCaptureController({
		capture: async (provider) => provider !== "minimax",
		now: () => now,
	});
	controller.begin("minimax");
	await controller.wait();
	// The capture of another provider ends after the failed one.
	controller.begin("openai");
	await controller.wait();
	// The failure of the first provider is still known: every provider
	// keeps its own outcome.
	assert.equal(controller.failed("minimax"), true);
	assert.equal(controller.failed("openai"), false);
});

test("the evidence of a provider is judged with the outcome of that provider", async () => {
	const controller = new QuotaCaptureController({
		capture: async (provider) => provider !== "minimax",
		now: () => now,
	});
	controller.begin("minimax");
	await controller.wait();
	controller.begin("openai");
	await controller.wait();
	// The row of the mirror of the failed provider cannot prove a
	// deadline, and the row of the other provider can.
	const later = new Date(now + 1000).toISOString();
	assert.equal(controller.allowsEvidence("minimax", later), false);
	assert.equal(controller.allowsEvidence("openai", later), true);
});

test("a capture that is still running is not started again", async () => {
	let calls = 0;
	let clock = now;
	const controller = new QuotaCaptureController({
		capture: async () => {
			calls += 1;
			// The capture of the browser takes longer than the window of
			// the reuse.
			await new Promise((resolve) => setTimeout(resolve, 50));
			return true;
		},
		now: () => clock,
		reuseMs: 1,
	});
	controller.begin("minimax");
	// The window of the reuse is over while the capture is still running.
	clock = now + 1000;
	controller.begin("minimax");
	await controller.wait();
	// The browser of the harness is not a resource that is spent twice
	// for one failure.
	assert.equal(calls, 1);
});
