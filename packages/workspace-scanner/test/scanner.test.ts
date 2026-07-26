import { describe, it, beforeEach, afterEach } from "node:test";
import { equal } from "node:assert";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { WorkspaceScanner } from "../src/scanner.js";

describe("WorkspaceScanner", () => {
	const testDir = join(tmpdir(), "ws-test-" + Date.now());
	beforeEach(() => mkdirSync(testDir, { recursive: true }));
	afterEach(() => rmSync(testDir, { recursive: true, force: true }));

	it("detects package.json", async () => {
		writeFileSync(
			join(testDir, "package.json"),
			JSON.stringify({ name: "test" }),
		);
		const scanner = new WorkspaceScanner(testDir);
		const snap = await scanner.scan();
		equal(snap.hasNode, true);
	});

	it("skips git when requested", async () => {
		const scanner = new WorkspaceScanner(testDir);
		const snap = await scanner.scan({ skipGit: true });
		equal(snap.git, null);
	});

	it("skips config when requested", async () => {
		const scanner = new WorkspaceScanner(testDir);
		const snap = await scanner.scan({ skipConfig: true });
		equal(snap.project, {});
		equal(snap.configFiles.length, 0);
	});

	it("detects env files", async () => {
		writeFileSync(join(testDir, ".env.local"), "SECRET=x");
		const scanner = new WorkspaceScanner(testDir);
		const snap = await scanner.scan({ skipConfig: false });
		equal(snap.envFiles.includes(".env.local"), true);
	});
});
