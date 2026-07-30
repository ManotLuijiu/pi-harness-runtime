import { describe, it, beforeEach, afterEach } from "node:test";
import { equal } from "node:assert";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { EventStore } from "../src/store.js";

describe("EventStore", () => {
	const dir = join(tmpdir(), "event-store-test-" + Date.now());
	beforeEach(() => mkdirSync(dir, { recursive: true }));
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const store = new EventStore({ sessionsDir: dir });

	it("append generates id and timestamp", async () => {
		const result = await store.append({
			sessionId: "test-1",
			type: "message",
			role: "user",
			content: "hello",
		});
		equal(typeof result.id, "string");
		equal(result.id.length > 0, true);
		equal(typeof result.timestamp, "string");
	});

	it("read returns appended events", async () => {
		await store.append({
			sessionId: "s1",
			type: "message",
			role: "user",
			content: "hello",
		});
		await store.append({
			sessionId: "s1",
			type: "message",
			role: "assistant",
			content: "hi",
		});
		const events = await store.read({ sessionId: "s1" });
		equal(events.length, 2);
		equal(events[0].content, "hello");
	});

	it("read filters by type", async () => {
		await store.append({
			sessionId: "s2",
			type: "message",
			role: "user",
			content: "a",
		});
		await store.append({
			sessionId: "s2",
			type: "tool_start",
			tool: "bash",
			content: "",
		});
		const events = await store.read({ sessionId: "s2", types: ["message"] });
		equal(events.length, 1);
	});

	it("search finds matching content", async () => {
		await store.append({
			sessionId: "s3",
			type: "message",
			role: "user",
			content: "fix the login bug",
		});
		await store.append({
			sessionId: "s3",
			type: "message",
			role: "user",
			content: "add dark mode",
		});
		const events = await store.search({ query: "login" });
		equal(events.length >= 1, true);
		equal(events[0].content?.includes("login"), true);
	});

	it("stats returns counts", async () => {
		await store.append({
			sessionId: "s4",
			type: "message",
			role: "user",
			content: "a",
		});
		await store.append({
			sessionId: "s4",
			type: "message",
			role: "user",
			content: "b",
		});
		const st = store.stats("s4");
		equal(st.totalEvents, 2);
		equal(st.sizeBytes > 0, true);
	});

	it("list returns session IDs", async () => {
		await store.append({
			sessionId: "alpha",
			type: "message",
			role: "user",
			content: "x",
		});
		await store.append({
			sessionId: "beta",
			type: "message",
			role: "user",
			content: "y",
		});
		const sessions = store.list();
		equal(sessions.includes("alpha"), true);
		equal(sessions.includes("beta"), true);
	});
});
