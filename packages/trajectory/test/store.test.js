import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { rmSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { TrajectoryStore } from "../src/store.js";
const TEST_DIR = join(homedir(), ".pi-harness-test-trajectories");
function freshStore() {
    // Override getTrajDir by patching the store's internals
    // We use a test dir instead
    rmSync(TEST_DIR, { force: true, recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    return new TrajectoryStore();
}
describe("TrajectoryStore", () => {
    beforeEach(() => {
        rmSync(TEST_DIR, { force: true, recursive: true });
        mkdirSync(TEST_DIR, { recursive: true });
    });
    it("start() returns a UUID", () => {
        const store = freshStore();
        const id = store.start("test task");
        assert.match(id, /^[0-9a-f-]{36}$/);
    });
    it("append() writes NDJSON to the correct daily file", () => {
        const store = freshStore();
        const id = "test-id-123";
        const now = new Date();
        store.append({
            id,
            taskRequest: "fix the login bug",
            createdAt: now.toISOString(),
            durationMs: 5000,
            iterations: 2,
            verdict: "approved",
            reason: "reviewer approved",
            plan: "# Plan\n1. Fix it",
            code: "// fixed",
            files: ["auth.ts"],
            comments: [
                { file: "auth.ts", comment: "looks good", severity: "minor" },
            ],
            summary: "looks good",
            classified: false,
        });
        // Should have created a daily file
        const files = readdirSync(TEST_DIR);
        assert.ok(files.length > 0, "should create at least one directory");
        // Navigate to the daily file
        const monthDir = files[0];
        const monthFiles = readdirSync(join(TEST_DIR, monthDir));
        assert.ok(monthFiles.length > 0, "should create daily ndjson file");
        const content = readFileSync(
            join(TEST_DIR, monthDir, monthFiles[0]),
            "utf8",
        );
        const record = JSON.parse(content.split("\n").find((l) => l.trim()));
        assert.strictEqual(record.id, id);
        assert.strictEqual(record.verdict, "approved");
        assert.strictEqual(record.iterations, 2);
    });
    it("list() returns records newest-first", () => {
        const store = freshStore();
        const id1 = store.start("task 1");
        store.append({
            id: id1,
            taskRequest: "task 1",
            createdAt: "2025-07-01T10:00:00.000Z",
            durationMs: 1000,
            iterations: 1,
            verdict: "approved",
            reason: "ok",
            plan: "p1",
            code: "c1",
            files: [],
            comments: [],
            summary: "s1",
            classified: false,
        });
        const id2 = store.start("task 2");
        store.append({
            id: id2,
            taskRequest: "task 2",
            createdAt: "2025-07-02T10:00:00.000Z",
            durationMs: 2000,
            iterations: 2,
            verdict: "changes_requested",
            reason: "converged: only minor comments",
            plan: "p2",
            code: "c2",
            files: [],
            comments: [],
            summary: "s2",
            classified: false,
        });
        const all = store.list();
        assert.strictEqual(all.length, 2);
        assert.strictEqual(all[0].id, id2, "newest first");
        assert.strictEqual(all[1].id, id1);
    });
    it("stats() aggregates correctly", () => {
        const store = freshStore();
        store.append({
            id: "s1",
            taskRequest: "t1",
            createdAt: "2025-07-01T10:00:00.000Z",
            durationMs: 1000,
            iterations: 1,
            verdict: "approved",
            reason: "reviewer approved",
            plan: "p",
            code: "c",
            files: ["a.ts"],
            comments: [],
            summary: "s",
            classified: false,
        });
        store.append({
            id: "s2",
            taskRequest: "t2",
            createdAt: "2025-07-01T11:00:00.000Z",
            durationMs: 3000,
            iterations: 3,
            verdict: "changes_requested",
            reason: "max iterations (3) reached with changes still requested",
            plan: "p",
            code: "c",
            files: ["a.ts", "b.ts"],
            comments: [],
            summary: "s",
            classified: false,
        });
        const stats = store.stats();
        assert.strictEqual(stats.total, 2);
        assert.strictEqual(stats.byVerdict.approved, 1);
        assert.strictEqual(stats.byVerdict.changes_requested, 1);
        assert.strictEqual(stats.avgIterations, 2);
        assert.strictEqual(stats.avgDurationMs, 2000);
        assert.strictEqual(stats.byFile["a.ts"], 2);
        assert.strictEqual(stats.byFile["b.ts"], 1);
        assert.strictEqual(stats.byLabel["max-iterations"], 1);
        assert.strictEqual(stats.byLabel["converged"], 1);
    });
    it("classify() returns correct label for converged", () => {
        const store = freshStore();
        const cls = store.classify({
            id: "x",
            taskRequest: "x",
            createdAt: new Date().toISOString(),
            durationMs: 1000,
            iterations: 1,
            verdict: "approved",
            reason: "reviewer approved",
            plan: "",
            code: "",
            files: [],
            comments: [],
            summary: "",
            classified: false,
        });
        assert.strictEqual(cls.label, "converged");
        assert.strictEqual(cls.trajectoryId, "x");
    });
    it("classify() returns stuck for same-file reason", () => {
        const store = freshStore();
        const cls = store.classify({
            id: "y",
            taskRequest: "y",
            createdAt: new Date().toISOString(),
            durationMs: 1000,
            iterations: 2,
            verdict: "changes_requested",
            reason: "stuck: same file (auth.ts) flagged for 3 comment(s)",
            plan: "",
            code: "",
            files: ["auth.ts"],
            comments: [],
            summary: "",
            classified: false,
        });
        assert.strictEqual(cls.label, "stuck");
        assert.strictEqual(cls.pattern, "same-file-repeated");
        assert.ok(cls.confidence < 1.0);
    });
    it("byVerdict() filters correctly", () => {
        const store = freshStore();
        store.append({
            id: "v1",
            taskRequest: "v1",
            createdAt: "2025-07-01T10:00:00.000Z",
            durationMs: 1000,
            iterations: 1,
            verdict: "approved",
            reason: "ok",
            plan: "",
            code: "",
            files: [],
            comments: [],
            summary: "",
            classified: false,
        });
        store.append({
            id: "v2",
            taskRequest: "v2",
            createdAt: "2025-07-02T10:00:00.000Z",
            durationMs: 1000,
            iterations: 1,
            verdict: "blocked",
            reason: "blocked",
            plan: "",
            code: "",
            files: [],
            comments: [],
            summary: "",
            classified: false,
        });
        const approved = store.byVerdict("approved");
        assert.strictEqual(approved.length, 1);
        assert.strictEqual(approved[0].id, "v1");
        const blocked = store.byVerdict("blocked");
        assert.strictEqual(blocked.length, 1);
        assert.strictEqual(blocked[0].id, "v2");
    });
    it("stats() handles empty store gracefully", () => {
        rmSync(TEST_DIR, { force: true, recursive: true });
        mkdirSync(TEST_DIR, { recursive: true });
        // Remove the month dir so the store sees an empty directory
        const store = freshStore();
        const stats = store.stats();
        assert.strictEqual(stats.total, 0);
        assert.strictEqual(stats.avgIterations, 0);
    });
});
//# sourceMappingURL=store.test.js.map
