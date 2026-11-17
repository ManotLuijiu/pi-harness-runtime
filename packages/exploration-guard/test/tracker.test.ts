import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExplorationStateStore } from "../src/state.js";
import { ExplorationTracker } from "../src/tracker.js";
import type { ExplorationBudget, ExplorationKey } from "../src/types.js";

const KEY: ExplorationKey = {
	workspace: "/home/frappe/project",
	sessionId: "session-1",
	generation: "gen-1",
	phase: "implementation",
	todoId: 5,
};

const TIGHT: ExplorationBudget = {
	readWarning: 1,
	readBudget: 6,
	stallWarning: 4,
	tokenWarning: 0,
	timeWarningMs: 0,
	repeatWarning: 2,
};

function temporaryTracker(): { tracker: ExplorationTracker; dir: string } {
	const dir = mkdtempSync(join(tmpdir(), "exploration-tracker-"));
	const tracker = new ExplorationTracker({
		store: new ExplorationStateStore(dir),
		budget: TIGHT,
		now: () => 1000,
	});
	return { tracker, dir };
}

function readCall(path: string, offset?: number, limit?: number) {
	return {
		toolName: "read",
		input: { path, offset, limit },
	};
}

describe("the tracker of the exploration", () => {
	test("a read is counted", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const result = tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 50),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			expect(result.state.readCount).toBe(1);
			expect(result.state.files).toHaveLength(1);
			expect(result.state.files[0].path).toBe("src/a.ts");
			expect(result.state.files[0].ranges).toEqual([
				{ start: 1, end: 50, truncated: false },
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a failed read is not counted", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const result = tracker.observe(
				KEY,
				readCall("src/a.ts"),
				{ toolName: "read", isError: true, result: "missing" },
			);
			expect(result.state.readCount).toBe(0);
			expect(result.state.files).toHaveLength(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a repeated read of the same range is counted as a repeat", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 50),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			const result = tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 50),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			expect(result.state.repeatCount).toBe(1);
			expect(result.state.files[0].repeatCount).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a read of a new range is not a repeat", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 50),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			const result = tracker.observe(
				KEY,
				readCall("src/a.ts", 60, 50),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			expect(result.state.repeatCount).toBe(0);
			expect(result.state.files[0].ranges).toHaveLength(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a search is counted as a search, not as a read of a file", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const result = tracker.observe(
				KEY,
				{ toolName: "grep", input: { pattern: "todo", path: "src" } },
				{ toolName: "grep", isError: false, result: { content: "m" } },
			);
			expect(result.state.searches).toHaveLength(1);
			expect(result.state.searches[0].query).toBe("todo");
			expect(result.state.files).toHaveLength(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a command the guard does not recognise leaves the coverage unknown", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const result = tracker.observe(
				KEY,
				{ toolName: "bash", input: { command: "npm run build" } },
				{ toolName: "bash", isError: false, result: { content: "ok" } },
			);
			expect(result.state.files).toHaveLength(0);
			expect(result.state.readCount).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a path that names a credential store is not tracked", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const result = tracker.observe(
				KEY,
				readCall("/home/frappe/.pi-harness-runtime/keys/token.txt"),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			expect(result.state.files).toHaveLength(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("the speech of the guard", () => {
	test("the guard speaks once per checkpoint revision", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const first = tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 10),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			expect(first.shouldSpeak).toBe(true);
			tracker.markSpoken(first.state);
			const second = tracker.observe(
				KEY,
				readCall("src/b.ts", 1, 10),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			expect(second.shouldSpeak).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a new checkpoint lets the guard speak again", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const first = tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 10),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			tracker.markSpoken(first.state);
			tracker.recordCheckpoint(KEY, { findings: [{ statement: "x" }] });
			const second = tracker.observe(
				KEY,
				readCall("src/b.ts", 1, 10),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			expect(second.shouldSpeak).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("the state of the tracker", () => {
	test("the state of a request survives the store", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const result = tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 10),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			tracker.save(KEY, result.state);
			const next = new ExplorationTracker({
				store: new ExplorationStateStore(dir),
				budget: TIGHT,
			});
			expect(next.state(KEY).readCount).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("another request has its own state", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const result = tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 10),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			tracker.save(KEY, result.state);
			const other = tracker.state({ ...KEY, generation: "gen-2" });
			expect(other.readCount).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the continuation names the checkpoint of the request", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			tracker.recordCheckpoint(KEY, {
				findings: [{ statement: "the reset lives in the provider" }],
				nextAction: "read the reset parser",
			});
			const text = tracker.continuationText(KEY);
			expect(text).toContain("the reset lives in the provider");
			expect(text).toContain("Reuse the recorded findings");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the status names the reads", () => {
		const { tracker, dir } = temporaryTracker();
		try {
			const result = tracker.observe(
				KEY,
				readCall("src/a.ts", 1, 10),
				{ toolName: "read", isError: false, result: { content: "x" } },
			);
			tracker.save(KEY, result.state);
			expect(tracker.status(KEY)).toContain("1 reads");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
