import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	shouldAskAgain,
	ToolingPreferenceStore,
	toolingPreferenceKey,
} from "../src/store.ts";

function storePath(): string {
	return join(mkdtempSync(join(tmpdir(), "tooling-store-")), "tooling-preference.json");
}

describe("ToolingPreferenceStore", () => {
	it("has no record for an unknown user and workspace", () => {
		const path = storePath();
		const store = new ToolingPreferenceStore(path);
		expect(store.read("user-1", "/work/web")).toBeUndefined();
	});

	it("keeps the record of a user in a workspace apart", () => {
		const path = storePath();
		const store = new ToolingPreferenceStore(path);
		store.recordDecision("user-1", "/work/web", "prefer_biome", "biome-1");
		store.recordDecision("user-2", "/work/web", "use_project_tools", "biome-2");
		store.recordDecision("user-1", "/work/other", "use_project_tools", "biome-3");

		expect(store.read("user-1", "/work/web")?.decision).toBe("prefer_biome");
		expect(store.read("user-2", "/work/web")?.decision).toBe("use_project_tools");
		expect(store.read("user-1", "/work/other")?.decision).toBe("use_project_tools");
	});

	it("remembers that the proposal was sent", () => {
		const path = storePath();
		const store = new ToolingPreferenceStore(path);
		store.markAsked("user-1", "/work/web", "biome-1");
		const record = store.read("user-1", "/work/web");
		expect(record?.askedAt).toBeTruthy();
		expect(record?.requestId).toBe("biome-1");
		expect(record?.decision).toBeUndefined();
	});

	it("keeps a decision across a new store instance", () => {
		const path = storePath();
		new ToolingPreferenceStore(path).recordDecision(
			"user-1",
			"/work/web",
			"prefer_biome",
			"biome-1",
			"telegram",
		);
		const record = new ToolingPreferenceStore(path).read("user-1", "/work/web");
		expect(record?.decision).toBe("prefer_biome");
		expect(record?.channel).toBe("telegram");
	});

	it("survives a broken store file", () => {
		const path = storePath();
		const store = new ToolingPreferenceStore(path);
		store.markAsked("user-1", "/work/web", "biome-1");
		// A store that cannot be read must not stop the harness.
		Bun.write(path, "not json");
		expect(store.read("user-1", "/work/web")).toBeUndefined();
	});

	it("keys a record by the user and the workspace", () => {
		expect(toolingPreferenceKey("user-1", "/work/web")).not.toBe(
			toolingPreferenceKey("user-2", "/work/web"),
		);
		expect(toolingPreferenceKey("user-1", "/work/web")).toBe(
			toolingPreferenceKey("user-1", "/work/web"),
		);
	});
});

describe("shouldAskAgain", () => {
	const day = 24 * 60 * 60 * 1000;
	const now = new Date("2026-10-24T12:00:00.000Z");

	it("asks a workspace that was never asked", () => {
		expect(shouldAskAgain(undefined, 30 * day, now)).toBe(true);
	});

	it("never asks a workspace with a decision", () => {
		const record = { decision: "prefer_biome" as const, askedAt: "2026-01-01T00:00:00.000Z" };
		expect(shouldAskAgain(record, 30 * day, now)).toBe(false);
	});

	it("does not ask again inside the cooldown", () => {
		const record = { askedAt: new Date(now.getTime() - day).toISOString() };
		expect(shouldAskAgain(record, 30 * day, now)).toBe(false);
	});

	it("asks again after the cooldown", () => {
		const record = { askedAt: new Date(now.getTime() - 31 * day).toISOString() };
		expect(shouldAskAgain(record, 30 * day, now)).toBe(true);
	});
});
