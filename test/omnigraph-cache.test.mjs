/**
 * Tests for the local cache of the OmniGraph source and for the manifest
 * of the supporting files of a skill.
 *
 * The cache is the boundary between the graph and the machine: a path of
 * the graph may not leave the tree of its skill, a body that does not
 * match the hash of the publication is not written, and a file that the
 * manifest does not describe well enough is never fetched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	cacheUsage,
	CachePathError,
	clearCache,
	containedPath,
	readCachedSkill,
	readCatalog,
	safeSegment,
	sha256Of,
	stubRoot,
	writeCachedResource,
	writeCachedSkill,
	writeCatalog,
	writeStubs,
} from "../harness/omnigraph/cache.ts";
import {
	GitCheckoutResourceFetcher,
	OmnigraphResourceError,
	parseResourceManifest,
} from "../harness/omnigraph/resources.ts";

/** A cache directory of a test. */
function cacheDir() {
	return mkdtempSync(join(tmpdir(), "omnigraph-cache-"));
}

/** An entry of a catalog. */
function entry(overrides = {}) {
	return {
		id: "the-skill",
		name: "the-skill",
		description: "a skill of the graph",
		revision: "abc123",
		sha256: "",
		...overrides,
	};
}

// --- the catalog ------------------------------------------------------------

test("the catalog survives a restart of the machine", () => {
	const dir = cacheDir();
	try {
		writeCatalog(dir, [entry()]);
		const read = readCatalog(dir);
		assert.equal(read.length, 1);
		assert.equal(read[0].id, "the-skill");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a cache without a catalog is a machine that has not read the graph", () => {
	const dir = cacheDir();
	try {
		assert.deepEqual(readCatalog(dir), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a catalog that is broken is not a catalog", () => {
	const dir = cacheDir();
	try {
		writeCatalog(dir, [entry()]);
		writeFileSync(join(dir, "catalog.json"), "{not json");
		assert.deepEqual(readCatalog(dir), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- the stubs --------------------------------------------------------------

test("a stub is a SKILL.md that points at the real instructions", () => {
	const dir = cacheDir();
	try {
		const written = writeStubs(dir, [entry({ sha256: "a".repeat(64) })]);
		assert.equal(written.length, 1);
		const markdown = readCachedSkillStub(dir, "the-skill");
		assert.match(markdown, /^---\nname: the-skill/);
		assert.match(markdown, /remote_skill_load/);
		assert.match(markdown, /abc123/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a skill that the catalog does not hold any more is not advertised", () => {
	const dir = cacheDir();
	try {
		writeStubs(dir, [entry(), entry({ id: "the-other", name: "the-other" })]);
		const root = stubRoot(dir);
		assert.ok(existsSync(join(root, "the-skill")));
		assert.ok(existsSync(join(root, "the-other")));
		writeStubs(dir, [entry()]);
		assert.ok(existsSync(join(root, "the-skill")));
		assert.ok(!existsSync(join(root, "the-other")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the name of a directory of the graph cannot become a path", () => {
	const segment = safeSegment("../../etc/passwd");
	assert.ok(!segment.includes("/"));
	assert.ok(!segment.startsWith("."));
	assert.ok(segment !== "..");
	assert.equal(safeSegment(""), "_");
});

// --- the hydrated skills ----------------------------------------------------

test("a body that does not match the hash of the publication is not written", () => {
	const dir = cacheDir();
	try {
		assert.throws(
			() =>
				writeCachedSkill(
					dir,
					entry({ sha256: sha256Of("the published body") }),
					"another body",
				),
			(error) => {
				assert.ok(error instanceof CachePathError);
				return true;
			},
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the body of a skill belongs to its revision", () => {
	const dir = cacheDir();
	try {
		const body = "the body of the skill";
		writeCachedSkill(dir, entry({ sha256: sha256Of(body) }), body);
		assert.equal(readCachedSkill(dir, "the-skill", "abc123"), body);
		// Another revision has no body of its own.
		assert.equal(readCachedSkill(dir, "the-skill", "another"), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a file of the graph may not leave the tree of its skill", () => {
	const dir = cacheDir();
	try {
		const root = join(dir, "skill");
		mkdirSync(root, { recursive: true });
		assert.throws(() => containedPath(root, "../outside.txt"), CachePathError);
		assert.throws(() => containedPath(root, "/etc/passwd"), CachePathError);
		assert.throws(() => containedPath(root, "a/../../outside"), CachePathError);
		assert.ok(containedPath(root, "scripts/run.sh").endsWith("scripts/run.sh"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a file whose content does not match the hash is not written", () => {
	const dir = cacheDir();
	try {
		assert.throws(
			() =>
				writeCachedResource(
					dir,
					"the-skill",
					"abc123",
					"scripts/run.sh",
					new TextEncoder().encode("#!/bin/sh\n"),
					sha256Of("something else"),
				),
			CachePathError,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the cache is measured in bytes and can be emptied", () => {
	const dir = cacheDir();
	try {
		writeCatalog(dir, [entry()]);
		assert.ok(cacheUsage(dir) > 0);
		clearCache(dir);
		assert.equal(cacheUsage(dir), 0);
		assert.ok(!existsSync(dir));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- the manifest of the files ----------------------------------------------

test("a manifest of a shape that is not known is not used", () => {
	const manifest = parseResourceManifest(
		JSON.stringify({ something: "else" }),
	);
	assert.equal(manifest.resources.length, 0);
	assert.match(manifest.error ?? "", /shape/);
});

test("a manifest that is not JSON is not used", () => {
	const manifest = parseResourceManifest("not json at all");
	assert.equal(manifest.resources.length, 0);
	assert.match(manifest.error ?? "", /JSON/);
});

test("a file without a hash cannot be fetched", () => {
	const manifest = parseResourceManifest(
		JSON.stringify([
			{ path: "scripts/run.sh", bytes: 12 },
			{ path: "reference.md", bytes: 4, sha256: sha256Of("abcd") },
		]),
	);
	assert.equal(manifest.resources.length, 2);
	assert.equal(manifest.resources[0].state, "unsupported");
	assert.match(manifest.resources[0].reason ?? "", /hash/);
	assert.equal(manifest.resources[1].state, "supported");
});

test("a manifest under a known name is read too", () => {
	const manifest = parseResourceManifest(
		JSON.stringify({
			resources: [{ path: "reference.md", bytes: 4, sha256: sha256Of("abcd") }],
		}),
	);
	assert.equal(manifest.resources.length, 1);
	assert.equal(manifest.resources[0].state, "supported");
});

// --- the reader of the files ------------------------------------------------

test("a file is read at the exact revision of the publication", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omnigraph-repo-"));
	try {
		execFileSync("git", ["init", "-q", dir]);
		execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
		execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
		mkdirSync(join(dir, "skills", "the-skill"), { recursive: true });
		writeFileSync(join(dir, "skills", "the-skill", "run.sh"), "first\n");
		execFileSync("git", ["-C", dir, "add", "-A"]);
		execFileSync("git", ["-C", dir, "commit", "-qm", "first"]);
		const revision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim();
		writeFileSync(join(dir, "skills", "the-skill", "run.sh"), "second\n");
		execFileSync("git", ["-C", dir, "add", "-A"]);
		execFileSync("git", ["-C", dir, "commit", "-qm", "second"]);

		const content = "first\n";
		const fetcher = new GitCheckoutResourceFetcher(dir);
		const fetched = await fetcher.fetch(
			{
				path: "skills/the-skill/run.sh",
				bytes: content.length,
				sha256: sha256Of(content),
				state: "supported",
			},
			revision,
		);
		assert.equal(new TextDecoder().decode(fetched), "first\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a file whose content does not match the hash is refused", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omnigraph-repo-"));
	try {
		execFileSync("git", ["init", "-q", dir]);
		execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
		execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
		writeFileSync(join(dir, "run.sh"), "first\n");
		execFileSync("git", ["-C", dir, "add", "-A"]);
		execFileSync("git", ["-C", dir, "commit", "-qm", "first"]);
		const revision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim();

		const fetcher = new GitCheckoutResourceFetcher(dir);
		await assert.rejects(
			() =>
				fetcher.fetch(
					{
						path: "run.sh",
						bytes: 6,
						sha256: sha256Of("another content"),
						state: "supported",
					},
					revision,
				),
			(error) => {
				assert.ok(error instanceof OmnigraphResourceError);
				return true;
			},
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a file that is not in the checkout is refused", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omnigraph-repo-"));
	try {
		execFileSync("git", ["init", "-q", dir]);
		execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
		execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
		writeFileSync(join(dir, "run.sh"), "first\n");
		execFileSync("git", ["-C", dir, "add", "-A"]);
		execFileSync("git", ["-C", dir, "commit", "-qm", "first"]);
		const revision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim();

		const fetcher = new GitCheckoutResourceFetcher(dir);
		await assert.rejects(
			() =>
				fetcher.fetch(
					{
						path: "missing.sh",
						bytes: 0,
						sha256: sha256Of(""),
						state: "supported",
					},
					revision,
				),
			OmnigraphResourceError,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** The SKILL.md of a stub of the cache. */
function readCachedSkillStub(dir, id) {
	const file = join(stubRoot(dir), id, "SKILL.md");
	return existsSync(file) ? readFileSync(file, "utf8") : "";
}
