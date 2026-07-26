import { describe, it } from "node:test";
import { equal } from "node:assert";
import { WorkspaceScanner } from "../src/scanner.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
describe("WorkspaceScanner", () => {
    const testDir = join(tmpdir(), "ws-scanner-test-" + Date.now());
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test", scripts: { dev: "vite" } }));
    const scanner = new WorkspaceScanner(testDir);
    it("scans workspace with git state", async () => {
        const snapshot = await scanner.scan();
        equal(typeof snapshot.root, "string");
        equal(typeof snapshot.hasGit, "boolean");
        equal(typeof snapshot.hasNode, "boolean");
    });
    it("skips git when requested", async () => {
        const snapshot = await scanner.scan({ skipGit: true });
        equal(snapshot.git, null);
    });
    it("skips config when requested", async () => {
        const snapshot = await scanner.scan({ skipConfig: true });
        equal(snapshot.project, {});
    });
    it("detects package.json", async () => {
        const snapshot = await scanner.scan();
        equal(snapshot.hasNode, true);
    });
    rmSync(testDir, { recursive: true, force: true });
});
