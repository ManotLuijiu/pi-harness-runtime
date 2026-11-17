import { describe, expect, test } from "bun:test";
import {
	applyCheckpoint,
	buildContinuationText,
	describeUnreadableCheckpoint,
	filesNeedingRevalidation,
	fromCompactCheckpoint,
	summarizeCheckpoint,
	toCompactCheckpoint,
} from "../src/checkpoint.js";
import { createState, ensureCoverage } from "../src/state.js";
import type { ExplorationKey } from "../src/types.js";

const KEY: ExplorationKey = {
	workspace: "/home/frappe/project",
	sessionId: "session-1",
	generation: "gen-1",
	phase: "implementation",
	todoId: 3,
};

function baseState() {
	const state = createState(KEY, 1000);
	state.readCount = 12;
	state.repeatCount = 2;
	return state;
}

describe("the checkpoint of the agent", () => {
	test("the checkpoint is merged into the state", () => {
		const state = applyCheckpoint(baseState(), {
			findings: [{ statement: "the reset lives in the provider", locations: ["src/a.ts"] }],
			hypotheses: [{ statement: "the cookie is stale", rejected: true }],
			openQuestions: ["where is the reset read?"],
			nextAction: "read the reset parser",
		}, 2000);
		expect(state.checkpoint.findings).toHaveLength(1);
		expect(state.checkpoint.findings[0].statement).toBe(
			"the reset lives in the provider",
		);
		expect(state.checkpoint.hypotheses[0].rejected).toBe(true);
		expect(state.checkpoint.openQuestions).toEqual(["where is the reset read?"]);
		expect(state.checkpoint.nextAction).toBe("read the reset parser");
		expect(state.checkpointRevision).toBe(1);
	});

	test("a credential in a finding is removed", () => {
		const state = applyCheckpoint(baseState(), {
			findings: [{ statement: "the token=sk-secret was in the file" }],
		}, 2000);
		expect(state.checkpoint.findings[0].statement).not.toContain("sk-secret");
	});

	test("a reference records the hash of the file", () => {
		const state = applyCheckpoint(baseState(), {
			references: [{ path: "src/a.ts", contentHash: "abc123" }],
		}, 2000);
		expect(state.files).toHaveLength(1);
		expect(state.files[0].path).toBe("src/a.ts");
		expect(state.files[0].contentHash).toBe("abc123");
	});

	test("a hash that changed voids the coverage of the file", () => {
		let state = baseState();
		const coverage = ensureCoverage(state.files, "src/a.ts");
		coverage.ranges = [{ start: 1, end: 10 }];
		coverage.readCount = 3;
		coverage.contentHash = "abc123";

		state = applyCheckpoint(state, {
			references: [{ path: "src/a.ts", contentHash: "def456" }],
		}, 2000);
		// The file holds something else now: the ranges describe a content
		// that is gone, so a re-read is a new read.
		expect(state.files[0].contentHash).toBe("def456");
		expect(state.files[0].ranges).toHaveLength(0);
		expect(state.files[0].readCount).toBe(0);
	});

	test("the same hash keeps the coverage of the file", () => {
		let state = baseState();
		const coverage = ensureCoverage(state.files, "src/a.ts");
		coverage.ranges = [{ start: 1, end: 10 }];
		coverage.contentHash = "abc123";

		state = applyCheckpoint(state, {
			references: [{ path: "src/a.ts", contentHash: "abc123" }],
		}, 2000);
		expect(state.files[0].ranges).toHaveLength(1);
	});

	test("a path that names a credential store is not referenced", () => {
		const state = applyCheckpoint(baseState(), {
			references: [{ path: "/home/frappe/.pi-harness-runtime/keys/token.txt" }],
		}, 2000);
		expect(state.files).toHaveLength(0);
	});

	test("the revision rises with every checkpoint", () => {
		let state = baseState();
		state = applyCheckpoint(state, { findings: [{ statement: "a" }] }, 2000);
		state = applyCheckpoint(state, { findings: [{ statement: "b" }] }, 3000);
		expect(state.checkpointRevision).toBe(2);
		expect(state.checkpoint.findings).toHaveLength(1);
	});
});

describe("the compact checkpoint", () => {
	test("the checkpoint keeps the counters", () => {
		const state = applyCheckpoint(baseState(), {
			findings: [{ statement: "a" }],
		}, 2000);
		const compact = toCompactCheckpoint(state, 3000);
		expect(compact.readCount).toBe(12);
		expect(compact.repeatCount).toBe(2);
		expect(compact.findings).toHaveLength(1);
		expect(compact.revision).toBe(1);
	});

	test("the checkpoint restores the counters of the request", () => {
		const state = applyCheckpoint(baseState(), {
			findings: [{ statement: "a" }],
		}, 2000);
		const compact = toCompactCheckpoint(state, 3000);
		const restored = fromCompactCheckpoint(compact, createState(KEY, 4000));
		expect(restored.readCount).toBe(12);
		expect(restored.repeatCount).toBe(2);
		expect(restored.checkpoint.findings).toHaveLength(1);
		expect(restored.previousCheckpointConsumed).toBe(true);
	});

	test("a checkpoint of another request is not restored into this one", () => {
		const other = toCompactCheckpoint(
			{ ...baseState(), sessionId: "session-2" },
			3000,
		);
		const restored = fromCompactCheckpoint(other, createState(KEY, 4000));
		expect(restored.sessionId).toBe("session-2");
	});
});

describe("the summary of the checkpoint", () => {
	test("an empty checkpoint has no summary", () => {
		expect(summarizeCheckpoint(baseState())).toBe("");
	});

	test("the summary names the findings and the questions", () => {
		const state = applyCheckpoint(baseState(), {
			findings: [{ statement: "the reset lives in the provider", locations: ["src/a.ts"] }],
			openQuestions: ["where is the reset read?"],
			nextAction: "read the reset parser",
		}, 2000);
		const summary = summarizeCheckpoint(state);
		expect(summary).toContain("the reset lives in the provider");
		expect(summary).toContain("src/a.ts");
		expect(summary).toContain("where is the reset read?");
		expect(summary).toContain("read the reset parser");
	});

	test("a ruled out hypothesis is named as ruled out", () => {
		const state = applyCheckpoint(baseState(), {
			hypotheses: [{ statement: "the cookie is stale", rejected: true }],
		}, 2000);
		expect(summarizeCheckpoint(state)).toContain("Ruled out");
	});
});

describe("the continuation after a compaction", () => {
	test("the continuation asks the agent to reuse the findings", () => {
		const state = applyCheckpoint(baseState(), {
			findings: [{ statement: "a" }],
		}, 2000);
		const text = buildContinuationText(state);
		expect(text).toContain("survived the compaction");
		expect(text).toContain("12 reads");
		expect(text).toContain("Reuse the recorded findings");
		expect(text).toContain("implement the smallest justified change");
	});

	test("the continuation authorises nothing beyond the work", () => {
		const text = buildContinuationText(baseState());
		expect(text).not.toContain("commit");
		expect(text).not.toContain("push");
		expect(text).not.toContain("build");
	});
});

describe("the revalidation of the references", () => {
	test("a file whose hash changed has to be checked", () => {
		const state = baseState();
		const coverage = ensureCoverage(state.files, "src/a.ts");
		coverage.contentHash = "old";
		const needs = filesNeedingRevalidation(state, { "src/a.ts": "new" });
		expect(needs).toEqual([{ path: "src/a.ts", reason: "changed" }]);
	});

	test("a file whose hash is unchanged does not have to be checked", () => {
		const state = baseState();
		const coverage = ensureCoverage(state.files, "src/a.ts");
		coverage.contentHash = "same";
		expect(filesNeedingRevalidation(state, { "src/a.ts": "same" })).toEqual([]);
	});

	test("a file without a known hash is unknown, not confirmed", () => {
		const state = baseState();
		ensureCoverage(state.files, "src/a.ts");
		const needs = filesNeedingRevalidation(state, {});
		expect(needs).toEqual([{ path: "src/a.ts", reason: "unknown" }]);
	});
});

describe("a checkpoint that cannot be read", () => {
	test("the text names the uncertainty", () => {
		const text = describeUnreadableCheckpoint("the file is corrupt");
		expect(text).toContain("could not be read");
		expect(text).toContain("is unknown");
		expect(text).toContain("rebuild a bounded subset");
	});
});
