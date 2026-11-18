/**
 * The runtime of the exploration guard.
 *
 * The runtime observes the tools of the agent, keeps the state of the
 * request and hands the decision of the guard to the caller at a safe
 * boundary.
 *
 * The tests use a temporary directory and a fake clock: no real session, no
 * real store, no model.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ExplorationGuardRuntime } from "../harness/exploration-guard-runtime.ts";
import { ExplorationStateStore } from "../packages/exploration-guard/dist/index.js";
import { ExplorationTracker } from "../packages/exploration-guard/dist/index.js";

/** A temporary directory for a fixture. */
function temporary() {
	return mkdtempSync(join(tmpdir(), "exploration-guard-runtime-"));
}

/**
 * A runtime with a pinned clock and a temporary store.
 */
function makeRuntime(dir, overrides = {}) {
	const tracker = new ExplorationTracker({
		store: new ExplorationStateStore(dir),
		budget: {
			readWarning: 1,
			readBudget: 6,
			stallWarning: 4,
			tokenWarning: 0,
			timeWarningMs: 0,
			repeatWarning: 2,
			...overrides.budget,
		},
		now: () => 1000,
	});
	let generation = "gen-1";
	const runtime = new ExplorationGuardRuntime({
		tracker,
		identity: {
			workspace: () => "/home/frappe/project",
			sessionId: () => "session-1",
			generation: () => generation,
			phase: () => "implementation",
			todoId: () => 5,
			...overrides.identity,
		},
		now: () => 1000,
	});
	return {
		runtime,
		setGeneration: (value) => {
			generation = value;
		},
	};
}

/** A read that succeeded. */
function readCall(path, offset = 1, limit = 50) {
	return { toolName: "read", input: { path, offset, limit } };
}

test("a read is observed and the guard speaks once", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		const pending = runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(pending, "the guard has something to say");
		assert.equal(pending.key.workspace, "/home/frappe/project");
		assert.equal(pending.key.sessionId, "session-1");
		assert.equal(pending.key.generation, "gen-1");
		assert.equal(pending.key.todoId, 5);
		assert.ok(pending.message.length > 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the guard does not speak twice without a new checkpoint", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		const first = runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(first, "the first intervention was not queued");
		// The intervention reached the agent: the guard remembers it.
		runtime.delivered(first);
		runtime.toolCall("call-2", readCall("src/b.ts"));
		const second = runtime.toolCallEnd("call-2", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.equal(second, null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an intervention that was not delivered may be spoken again", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		const first = runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(first, "the first intervention was not queued");
		// Nothing was delivered: the agent heard nothing, so the guard may
		// speak again.
		runtime.toolCall("call-2", readCall("src/b.ts"));
		const second = runtime.toolCallEnd("call-2", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(second, "the guard stayed quiet after a refused delivery");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a delivered intervention is not repeated after a restart", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		const first = runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(first, "the first intervention was not queued");
		runtime.delivered(first);

		// A new runtime reads the state of the request from the store: the
		// memory of the guard belongs to the request and not to the
		// process.
		const { runtime: restarted } = makeRuntime(dir);
		restarted.toolCall("call-2", readCall("src/b.ts"));
		const second = restarted.toolCallEnd("call-2", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.equal(second, null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a new checkpoint opens a new intervention", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		const first = runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(first, "the first intervention was not queued");
		runtime.delivered(first);

		// The agent reports a checkpoint: a new revision opens a new
		// intervention.
		runtime.recordCheckpoint({ findings: [{ statement: "the shape of the guard" }] });
		runtime.toolCall("call-2", readCall("src/b.ts"));
		const second = runtime.toolCallEnd("call-2", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(second, "the guard stayed quiet after a new checkpoint");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the guard counts a speech only after the delivery worked", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir, {
			budget: {
				readWarning: 0,
				readBudget: 1,
				stallWarning: 0,
				tokenWarning: 0,
				timeWarningMs: 0,
				repeatWarning: 99,
			},
		});
		const queued = [];
		for (let index = 0; index < 4; index += 1) {
			// A checkpoint opens a new revision, and a new revision opens a
			// new intervention.
			runtime.recordCheckpoint({
				findings: [{ statement: `finding ${index}` }],
			});
			runtime.toolCall(`call-${index}`, readCall(`src/${index}.ts`));
			const pending = runtime.toolCallEnd(`call-${index}`, {
				toolName: "read",
				isError: false,
				result: { content: "x" },
			});
			queued.push(pending);
		}
		// Four interventions were queued. The guard speaks at most three
		// times, but nothing was delivered: the budget of the speeches was
		// not spent.
		assert.ok(queued[3], "the fourth intervention was queued");
		// The deliveries work now.
		for (const pending of queued) {
			runtime.delivered(pending);
		}
		// The budget of the three speeches is spent: the fifth is refused.
		runtime.recordCheckpoint({ findings: [{ statement: "finding 4" }] });
		runtime.toolCall("call-4", readCall("src/4.ts"));
		const fifth = runtime.toolCallEnd("call-4", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.equal(fifth, null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a failed read is not observed", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		const pending = runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: true,
			result: "no such file",
		});
		assert.equal(pending, null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a call without a beginning is ignored", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		const pending = runtime.toolCallEnd("call-unknown", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.equal(pending, null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the intervention is consumed once", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		const pending = runtime.takePending();
		assert.ok(pending);
		assert.equal(runtime.takePending(), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the intervention of an old request is inert", () => {
	const dir = temporary();
	try {
		const { runtime, setGeneration } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		setGeneration("gen-2");
		assert.equal(runtime.takePending(), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a finished request makes the pending actions inert", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.deactivate();
		runtime.toolCall("call-1", readCall("src/a.ts"));
		const pending = runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.equal(pending, null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a new request activates the guard again", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.deactivate();
		runtime.activate();
		runtime.toolCall("call-1", readCall("src/a.ts"));
		const pending = runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(pending);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the continuation after a compaction names the checkpoint", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		const text = runtime.continuationAfterCompaction();
		assert.ok(text.includes("survived the compaction"));
		assert.ok(text.includes("Reuse the recorded findings"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the continuation authorises nothing", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		const text = runtime.continuationAfterCompaction();
		assert.ok(!text.includes("commit"));
		assert.ok(!text.includes("push"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the status names the reads", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "x" },
		});
		assert.ok(runtime.status().includes("1 reads"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the checkpoint of the agent is recorded", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		const recorded = runtime.recordCheckpoint({
			findings: [{ statement: "the reset lives in the provider", locations: ["src/a.ts"] }],
			hypotheses: [{ statement: "the cookie is stale", rejected: true }],
			openQuestions: ["where is the reset read?"],
			nextAction: "read the reset parser",
			references: [{ path: "src/a.ts", contentHash: "abc123" }],
		});
		assert.equal(recorded, true);
		const continuation = runtime.continuationAfterCompaction();
		assert.match(continuation, /the reset lives in the provider/);
		assert.match(continuation, /read the reset parser/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a checkpoint of a finished request is refused", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.deactivate();
		const recorded = runtime.recordCheckpoint({
			findings: [{ statement: "a finding of a request that is over" }],
		});
		assert.equal(recorded, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the recorded checkpoint is written to the store", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.recordCheckpoint({
			findings: [{ statement: "the finding survives the compaction" }],
		});
		// A new runtime reads the state of the request from the store.
		const second = makeRuntime(dir);
		const continuation = second.runtime.continuationAfterCompaction();
		assert.match(continuation, /the finding survives the compaction/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the checkpoint of the request is compact and holds no content", () => {
	const dir = temporary();
	try {
		const { runtime } = makeRuntime(dir);
		runtime.toolCall("call-1", readCall("src/a.ts"));
		runtime.toolCallEnd("call-1", {
			toolName: "read",
			isError: false,
			result: { content: "the secret content of the file" },
		});
		const compact = runtime.compactCheckpoint();
		assert.ok(compact);
		assert.equal(compact.readCount, 1);
		assert.ok(!JSON.stringify(compact).includes("the secret content"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
