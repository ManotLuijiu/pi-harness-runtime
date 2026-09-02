/**
 * FileCheckpointSaver tests — T9–T11 (wiki/auto-trigger-multi-agent.md §M5)
 *
 * Run:
 *   bun test harness/langchain/checkpointer.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { FileCheckpointSaver, createLoopCheckpointer } from "./checkpointer.js";
// ─── Fixtures ────────────────────────────────────────────────────────────────
const ROOT = `/tmp/checkpointer-test-${randomUUID().slice(0, 8)}`;
function freshSaver() {
    const saver = new FileCheckpointSaver({ root: ROOT });
    saver.clearAll();
    return saver;
}
const THREAD = "thread-abc123";
const CONFIG = { configurable: { thread_id: THREAD } };
const CONFIG_WITH_CPID = {
    configurable: { thread_id: THREAD, checkpoint_id: "cp-001" },
};
// ─── T9: Basic put/get ──────────────────────────────────────────────────────
describe("T9 — put and get basic checkpoint", () => {
    it("stores and retrieves a checkpoint", async () => {
        const saver = freshSaver();
        const checkpoint = {
            v: 4,
            id: "cp-001",
            ts: "2026-08-31T10:00:00.000Z",
            channel_values: { plan: "do the thing", code: "" },
            channel_versions: { plan: 1, code: 0 },
            versions_seen: {},
        };
        const metadata = {
            source: "input",
            step: -1,
            parents: {},
        };
        const updatedConfig = await saver.put(CONFIG, checkpoint, metadata, {});
        assert.equal(updatedConfig.configurable?.checkpoint_id, "cp-001");
        // Retrieve it
        const tuple = await saver.getTuple(CONFIG_WITH_CPID);
        assert.ok(tuple, "should retrieve the checkpoint");
        assert.equal(tuple?.checkpoint.id, "cp-001");
        assert.equal(tuple?.checkpoint.channel_values?.plan, "do the thing");
    });
    it("get() returns the checkpoint", async () => {
        const saver = freshSaver();
        const cp = {
            v: 4,
            id: "cp-get",
            ts: "2026-08-31T10:01:00.000Z",
            channel_values: { plan: "test plan" },
            channel_versions: {},
            versions_seen: {},
        };
        await saver.put(CONFIG, cp, { source: "input", step: -1, parents: {} }, {});
        const retrieved = await saver.get({
            configurable: { thread_id: THREAD, checkpoint_id: "cp-get" },
        });
        assert.ok(retrieved, "should return the checkpoint");
        assert.equal(retrieved?.id, "cp-get");
    });
});
// ─── T10: Parent chain ──────────────────────────────────────────────────────
describe("T10 — parent chain", () => {
    it("stores and retrieves a parent chain (resume)", async () => {
        const saver = freshSaver();
        const root = {
            v: 4,
            id: "root",
            ts: "2026-08-31T10:00:00.000Z",
            channel_values: {},
            channel_versions: {},
            versions_seen: {},
        };
        const child = {
            v: 4,
            id: "child",
            ts: "2026-08-31T10:01:00.000Z",
            channel_values: { plan: "the plan" },
            channel_versions: { plan: 1 },
            versions_seen: {},
        };
        await saver.put(CONFIG, root, { source: "input", step: -1, parents: {} }, {});
        await saver.put(CONFIG, child, { source: "loop", step: 0, parents: { "": "root" } }, {});
        // Retrieve child and verify parent
        const tuple = await saver.getTuple({
            configurable: { thread_id: THREAD, checkpoint_id: "child" },
        });
        assert.ok(tuple);
        assert.ok(tuple?.parentConfig);
        assert.equal(tuple?.parentConfig?.configurable?.checkpoint_id, "root");
        // getTuple without checkpoint_id returns the latest
        const latest = await saver.getTuple(CONFIG);
        assert.ok(latest);
        assert.equal(latest?.checkpoint.id, "child");
    });
});
// ─── T11: list + deleteThread ───────────────────────────────────────────────
describe("T11 — list and deleteThread", () => {
    it("lists checkpoints in reverse chronological order", async () => {
        const saver = freshSaver();
        for (let i = 0; i < 5; i++) {
            const cp = {
                v: 4,
                id: `cp-${i}`,
                ts: new Date(1000 + i * 1000).toISOString(),
                channel_values: { step: i },
                channel_versions: {},
                versions_seen: {},
            };
            await saver.put(CONFIG, cp, { source: "loop", step: i, parents: {} }, {});
        }
        const all = [];
        for await (const tuple of saver.list(CONFIG)) {
            all.push(tuple.checkpoint.id);
        }
        assert.equal(all.length, 5);
        // Newest first
        assert.equal(all[0], "cp-4");
        assert.equal(all[4], "cp-0");
    });
    it("limits list results", async () => {
        const saver = freshSaver();
        for (let i = 0; i < 3; i++) {
            const cp = {
                v: 4,
                id: `limit-${i}`,
                ts: new Date(2000 + i * 1000).toISOString(),
                channel_values: {},
                channel_versions: {},
                versions_seen: {},
            };
            await saver.put(CONFIG, cp, { source: "loop", step: i, parents: {} }, {});
        }
        const limited = [];
        for await (const tuple of saver.list(CONFIG, { limit: 2 })) {
            limited.push(tuple.checkpoint.id);
        }
        assert.equal(limited.length, 2);
    });
    it("deleteThread removes all checkpoints for a thread", async () => {
        const saver = freshSaver();
        const cp = {
            v: 4,
            id: "delete-me",
            ts: "2026-08-31T12:00:00.000Z",
            channel_values: {},
            channel_versions: {},
            versions_seen: {},
        };
        await saver.put(CONFIG, cp, { source: "input", step: -1, parents: {} }, {});
        assert.ok(await saver.getTuple(CONFIG), "checkpoint should exist");
        await saver.deleteThread(THREAD);
        assert.ok(!(await saver.getTuple(CONFIG)), "checkpoint should be gone after deleteThread");
    });
    it("toJSON returns a string (not the internal object)", async () => {
        const saver = freshSaver();
        const json = saver.toJSON();
        assert.equal(typeof json, "string");
        assert.ok(json.length > 0);
    });
    it("listThreads returns thread ids", async () => {
        const saver = freshSaver();
        const tid = `thread-${randomUUID().slice(0, 6)}`;
        const cp = {
            v: 4,
            id: "cp-t",
            ts: "2026-08-31T12:00:00.000Z",
            channel_values: {},
            channel_versions: {},
            versions_seen: {},
        };
        await saver.put({ configurable: { thread_id: tid } }, cp, { source: "input", step: -1, parents: {} }, {});
        const threads = saver.listThreads();
        assert.ok(threads.includes(tid), `Expected ${tid} in ${JSON.stringify(threads)}`);
    });
});
// ─── T12: createLoopCheckpointer factory ─────────────────────────────────────
describe("T12 — createLoopCheckpointer factory", () => {
    it("creates a saver with the correct root path", () => {
        const saver = createLoopCheckpointer("/my/workspace");
        assert.ok(saver instanceof FileCheckpointSaver);
    });
});
//# sourceMappingURL=checkpointer.test.js.map