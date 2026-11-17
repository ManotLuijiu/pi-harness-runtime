import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createState,
	ExplorationStateStore,
	normalizeState,
	sanitizePath,
	sanitizeText,
	stateFileName,
} from "../src/state.js";
import type { ExplorationKey } from "../src/types.js";

const KEY: ExplorationKey = {
	workspace: "/home/frappe/project",
	sessionId: "session-1",
	generation: "gen-1",
	phase: "implementation",
	todoId: 7,
};

function temporaryStore(): { store: ExplorationStateStore; dir: string } {
	const dir = mkdtempSync(join(tmpdir(), "exploration-guard-"));
	return { store: new ExplorationStateStore(dir), dir };
}

describe("the name of a state file", () => {
	test("every part of the identity is in the name", () => {
		const name = stateFileName(KEY);
		expect(name).toContain("project");
		expect(name).toContain("session-1");
		expect(name).toContain("gen-1");
		expect(name).toContain("implementation");
		expect(name).toContain("todo-7");
		expect(name.endsWith(".json")).toBe(true);
	});

	test("another session has another file", () => {
		const other = stateFileName({ ...KEY, sessionId: "session-2" });
		expect(other).not.toBe(stateFileName(KEY));
	});

	test("another generation has another file", () => {
		const other = stateFileName({ ...KEY, generation: "gen-2" });
		expect(other).not.toBe(stateFileName(KEY));
	});

	test("another workspace has another file", () => {
		const other = stateFileName({ ...KEY, workspace: "/home/frappe/other" });
		expect(other).not.toBe(stateFileName(KEY));
	});

	test("a path that is not safe for a file system is made safe", () => {
		const name = stateFileName({ ...KEY, sessionId: "a/b c" });
		expect(name).not.toContain("/");
		expect(name).not.toContain(" ");
	});
});

describe("the persisted state", () => {
	test("a state that was written is read back", () => {
		const { store, dir } = temporaryStore();
		try {
			const state = createState(KEY, 1000);
			state.readCount = 5;
			store.write(state);
			const read = store.read(KEY);
			expect(read?.readCount).toBe(5);
			expect(read?.workspace).toBe(KEY.workspace);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a request without a state has none", () => {
		const { store, dir } = temporaryStore();
		try {
			expect(store.read(KEY)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a state of another session is not returned", () => {
		const { store, dir } = temporaryStore();
		try {
			store.write(createState(KEY, 1000));
			expect(store.read({ ...KEY, sessionId: "session-2" })).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a state that is not valid JSON is an error, not a fresh state", () => {
		const { store, dir } = temporaryStore();
		try {
			store.write(createState(KEY, 1000));
			// Corrupt the file the way a crash would.
			writeFileSync(store.path(KEY), "{not json", "utf8");
			expect(() => store.read(KEY)).toThrow(/not valid JSON/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a state of another generation lives in another file", () => {
		const { store, dir } = temporaryStore();
		try {
			store.write(createState(KEY, 1000));
			expect(store.read({ ...KEY, generation: "gen-2" })).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a state of another generation is refused when it is read directly", () => {
		const state = createState(KEY, 1000);
		expect(() =>
			normalizeState(state, { ...KEY, generation: "gen-2" }),
		).toThrow(/another generation/);
	});

	test("a state of another session is refused when it is read directly", () => {
		const state = createState(KEY, 1000);
		expect(() =>
			normalizeState(state, { ...KEY, sessionId: "session-2" }),
		).toThrow(/another session/);
	});

	test("the write of a state is atomic and leaves no temporary file", () => {
		const { store, dir } = temporaryStore();
		try {
			store.write(createState(KEY, 1000));
			const files: string[] = readdirSync(dir);
			expect(files.filter((name: string) => name.endsWith(".tmp"))).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("the normalisation of a state", () => {
	test("a value that is not an object is refused", () => {
		expect(() => normalizeState("nonsense", KEY)).toThrow(/not an object/);
	});

	test("a state of another workspace is refused", () => {
		expect(() =>
			normalizeState({ workspace: "/other" }, KEY),
		).toThrow(/another workspace/);
	});
});

describe("the sanitisation", () => {
	test("a credential is removed from the text", () => {
		const text = sanitizeText("the key api_key=sk-secret-value was used");
		expect(text).not.toContain("sk-secret-value");
		expect(text).toContain("<redacted>");
	});

	test("a path that names a credential store is dropped", () => {
		expect(sanitizePath("/home/frappe/.pi-harness-runtime/keys/token.txt")).toBeUndefined();
		expect(sanitizePath("/home/frappe/.env")).toBeUndefined();
		expect(sanitizePath("src/a.ts")).toBe("src/a.ts");
	});

	test("an empty path is dropped", () => {
		expect(sanitizePath("   ")).toBeUndefined();
	});
});
