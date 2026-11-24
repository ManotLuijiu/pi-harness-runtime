import { test } from "node:test";
import assert from "node:assert/strict";
import {
	ExplorationContextGuard,
	explorationChunkText,
	registerExplorationContext,
} from "../harness/exploration-context.ts";

function checkpoint(overrides = {}) {
	return {
		workspace: "/fixture", sessionId: "session", generation: "request-1",
		phase: "implementation", readCount: 8, repeatCount: 0,
		estimatedTokens: 200, estimatedTokensApproximate: true, explorationTimeMs: 1,
		findings: [], hypotheses: [], openQuestions: [], revision: 0,
		references: [{ path: "src/a.ts" }], savedAt: 1000,
		...overrides,
	};
}

function fixture() {
	const handlers = new Map();
	let current = checkpoint();
	let paused = false;
	let pending = false;
	let work = "unfinished";
	let stateRead = async () => work;
	const source = { compactCheckpoint: () => current };
	const pi = { on: (name, handler) => handlers.set(name, handler) };
	registerExplorationContext(pi, {
		current: () => source, paused: () => paused,
		workState: () => stateRead(),
	});
	const ctx = {
		isIdle: () => false, signal: undefined,
		hasPendingMessages: () => pending,
		getContextUsage: () => ({ tokens: 1000, contextWindow: 10000 }),
	};
	const messages = [{ role: "user", content: "Fix the current request" }];
	return {
		handlers, ctx, messages,
		run: () => handlers.get("context")({ messages }, ctx),
		setCheckpoint: (value) => { current = value; },
		pause: (value) => { paused = value; },
		pending: (value) => { pending = value; },
		work: (value) => { work = value; },
		stateRead: (value) => { stateRead = value; },
	};
}

test("an active exploration receives chunk guidance without a continuation dispatch", async () => {
	// The mock has no sendMessage/sendUserMessage. The old busy-session
	// advisory path could not reach this active inference.
	const f = fixture();
	const result = await f.run();
	assert.equal(result.messages.length, 2);
	assert.equal(f.messages.length, 1, "the stored transcript is not changed");
	assert.equal(result.messages[1].customType, "harness:exploration-chunk");
	assert.match(result.messages[1].content, /todo tool/);
	assert.match(result.messages[1].content, /one outcome, its target files/);
	assert.match(result.messages[1].content, /No semantic findings/);
	assert.equal(await f.run(), undefined, "unchanged evidence does not repeat the nudge");
});

test("a long request gets another nudge per bounded chunk, beyond three lifetime warnings", () => {
	const guard = new ExplorationContextGuard();
	for (let reads = 8; reads <= 40; reads += 8) {
		const saved = checkpoint({ readCount: reads });
		assert.ok(guard.prepare(saved));
		guard.delivered(saved);
		assert.equal(guard.prepare(saved), undefined);
	}
});

test("a large search result triggers the token threshold without claiming a file was read", () => {
	const guard = new ExplorationContextGuard();
	const saved = checkpoint({ readCount: 0, estimatedTokens: 8000, references: [] });
	assert.match(guard.prepare(saved), /0 reads/);
	guard.delivered(saved);
	assert.equal(guard.prepare(saved), undefined);
});

test("context pressure warns early without a checkpoint-to-reminder loop", () => {
	const guard = new ExplorationContextGuard();
	const saved = checkpoint({ readCount: 1 });
	assert.equal(guard.prepare(saved, 59), undefined);
	assert.ok(guard.prepare(saved, 60));
	guard.delivered(saved);
	assert.equal(guard.prepare(saved, 80), undefined);
	assert.equal(guard.prepare({ ...saved, revision: 1 }, 80), undefined);
	assert.equal(new ExplorationContextGuard().prepare(checkpoint({ readCount: 0, estimatedTokens: 0 }), 95), undefined);
});

test("compaction restores findings and the exact next chunk without new reads or a resume message", async () => {
	const f = fixture();
	f.setCheckpoint(checkpoint({
		readCount: 2, findings: [{ statement: "Cause found", locations: ["src/a.ts:10"], at: 1 }],
		nextAction: "Todo 12: patch src/a.ts and run its focused test",
	}));
	assert.equal(await f.run(), undefined);
	f.handlers.get("session_compact")();
	const result = await f.run();
	assert.match(result.messages[1].content, /Cause found/);
	assert.match(result.messages[1].content, /Todo 12: patch src\/a.ts/);
	assert.equal(await f.run(), undefined);
});

test("a compaction from an older request cannot restore its findings into a new one", async () => {
	const f = fixture();
	f.handlers.get("session_compact")();
	f.setCheckpoint(checkpoint({ generation: "request-2", readCount: 0, estimatedTokens: 0 }));
	assert.equal(await f.run(), undefined);
});

test("pause, pending human input, cancellation, completion and inactive requests suppress the advisory", async () => {
	const f = fixture();
	f.pause(true); assert.equal(await f.run(), undefined);
	f.pause(false); f.pending(true); assert.equal(await f.run(), undefined);
	f.pending(false); f.ctx.signal = { aborted: true }; assert.equal(await f.run(), undefined);
	f.ctx.signal = undefined; f.work("complete"); assert.equal(await f.run(), undefined);
	f.work("unfinished"); f.setCheckpoint(null); assert.equal(await f.run(), undefined);
	f.setCheckpoint(checkpoint()); assert.ok(await f.run(), "suppression did not spend delivery watermarks");
});

test("the request is rechecked after an asynchronous completion read", async () => {
	for (const change of [
		(f) => f.setCheckpoint(checkpoint({ generation: "replaced" })),
		(f) => f.pause(true),
		(f) => f.pending(true),
	]) {
		const f = fixture();
		f.stateRead(async () => { change(f); return "unfinished"; });
		assert.equal(await f.run(), undefined);
	}
});

test("recovery guidance is bounded even with a full checkpoint", () => {
	const text = explorationChunkText(checkpoint({
		findings: Array.from({ length: 100 }, () => ({ statement: "x".repeat(5000), locations: ["y".repeat(5000)] })),
		hypotheses: Array.from({ length: 100 }, () => ({ statement: "z".repeat(5000), rejected: true })),
		openQuestions: Array(100).fill("q".repeat(5000)),
		references: Array.from({ length: 100 }, () => ({ path: "p".repeat(5000) })),
		nextAction: "n".repeat(5000),
	}));
	assert.ok(text.length < 14000, text.length);
});
