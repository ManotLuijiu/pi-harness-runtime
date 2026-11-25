/**
 * The regressions of the review of the OmniGraph source.
 *
 * Every test here reproduces a finding of the review and proves that the
 * finding is closed:
 *
 * - a link inside the cache is not a way out of the cache,
 * - a publication without a hash is not a verified body,
 * - a source that refuses the read never serves the catalog of another
 *   source, and the cache of a source belongs to that source,
 * - the discovery of the stubs does not race the first read of the
 *   catalog,
 * - a file belongs to the revision it was published with,
 * - the limits of the transport and of the cache are enforced,
 * - the small gaps of the source are closed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

import {
	CachePathError,
	makeRoomInCache,
	readCatalog,
	sha256Of,
	stubRoot,
	writeCachedResource,
	writeCachedSkill,
	writeCatalog,
	writeStubs,
} from "../harness/omnigraph/cache.ts";
import {
	cacheNamespace,
	readOmnigraphConfig,
} from "../harness/omnigraph/config.ts";
import {
	OmnigraphError,
	omnigraphQuery,
} from "../harness/omnigraph/transport.ts";
import {
	OmnigraphSkillSource,
	omnigraphInstructionsHash,
} from "../harness/omnigraph/source.ts";
import { registerOmnigraphSkills } from "../harness/omnigraph/registration.ts";

/** A directory of a test. */
function tempDir(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
}

/** An entry of a catalog. */
function entry(overrides = {}) {
	return {
		id: "the-skill",
		name: "the-skill",
		description: "a skill of the graph",
		revision: "abc123",
		sha256: "a".repeat(64),
		...overrides,
	};
}

/** The configuration of a test, with its own cache. */
function configOf(cacheDir, overrides = {}) {
	return {
		url: "https://graph.example",
		graph: "skills",
		token: "a-token-of-the-reader",
		apiVersion: "0.14",
		timeoutMs: 1000,
		catalogTimeoutMs: 500,
		cacheDir,
		cacheBudgetBytes: 1024 * 1024,
		maxAdvertisedSkills: 10,
		...overrides,
	};
}

/** A pi that records what an extension registers. */
function fakePi() {
	const tools = [];
	const commands = [];
	const handlers = new Map();
	return {
		tools,
		commands,
		handlers,
		on(event, handler) {
			handlers.set(event, handler);
		},
		registerTool(tool) {
			tools.push(tool);
		},
		registerCommand(name, options) {
			commands.push({ name, ...options });
		},
	};
}

/** The tool of the registration with this name. */
function toolOf(pi, name) {
	const tool = pi.tools.find((candidate) => candidate.name === name);
	assert.ok(tool, `the tool "${name}" was not registered`);
	return tool;
}

/** The text of the answer of a tool. */
function textOf(answer) {
	return answer.content.map((part) => part.text).join("\n");
}

/**
 * A source that answers what the test wants.
 *
 * The source is the boundary of the graph: the test replaces it, so the
 * behaviour of the registration is checked without a network.
 */
function sourceOf(overrides = {}) {
	return {
		async catalog() {
			if (overrides.catalogError) throw overrides.catalogError;
			return overrides.catalog ?? [
				{
					id: "the-skill",
					name: "the-skill",
					description: "a skill of the graph",
					revision: "abc123",
					sha256: "a".repeat(64),
				},
			];
		},
		async record(id, expectation) {
			if (overrides.recordError) throw overrides.recordError;
			const record = overrides.record ?? {
				id: "the-skill",
				name: "the-skill",
				description: "a skill of the graph",
				revision: "abc123",
				sha256: "a".repeat(64),
				instructions: "# The skill",
				resourcesJson: "[]",
			};
			if (record.id !== id) return null;
			if (expectation?.revision && expectation.revision !== record.revision) {
				throw new OmnigraphError(
					`the skill "${record.id}" is at the revision "${record.revision}", and the revision "${expectation.revision}" was expected`,
					"invalid",
				);
			}
			return record;
		},
	};
}

// --- P1: a link is not a way out of the cache -------------------------------

test("a link in the tree of the stubs is not a way out of the cache", () => {
	const dir = tempDir("omnigraph-review-cache-");
	const outside = tempDir("omnigraph-review-outside-");
	try {
		symlinkSync(outside, join(dir, "stubs"), "dir");
		assert.throws(
			() => writeStubs(dir, [entry()]),
			CachePathError,
		);
		assert.deepEqual(readdirSync(outside), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("a link in the tree of the skills is not a way out of the cache", () => {
	const dir = tempDir("omnigraph-review-cache-");
	const outside = tempDir("omnigraph-review-outside-");
	try {
		symlinkSync(outside, join(dir, "skills"), "dir");
		assert.throws(
			() => writeCachedSkill(dir, entry(), "# The skill"),
			CachePathError,
		);
		assert.deepEqual(readdirSync(outside), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("a link in the path of a file is not a way out of the skill", () => {
	const dir = tempDir("omnigraph-review-cache-");
	const outside = tempDir("omnigraph-review-outside-");
	try {
		const skill = join(dir, "skills", "the-skill", "abc123");
		mkdirSync(skill, { recursive: true });
		symlinkSync(outside, join(skill, "scripts"), "dir");
		assert.throws(
			() =>
				writeCachedResource(
					dir,
					"the-skill",
					"abc123",
					"scripts/run.sh",
					new TextEncoder().encode("#!/bin/sh\n"),
					sha256Of("#!/bin/sh\n"),
				),
			CachePathError,
		);
		assert.deepEqual(readdirSync(outside), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

// --- P1: a publication without a hash is not a verified body ----------------

test("a publication without a hash is not a verified body", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		const source = new OmnigraphSkillSource({
			config: configOf(dir),
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						columns: [
							"id",
							"name",
							"description",
							"revision",
							"sha256",
							"instructions",
							"resources_json",
						],
						rows: [
							[
								"the-skill",
								"the-skill",
								"a skill of the graph",
								"abc123",
								"",
								"# The skill",
								"[]",
							],
						],
					}),
					{ status: 200 },
				),
		});
		await assert.rejects(
			() => source.get("the-skill"),
			(error) => {
				assert.ok(error instanceof OmnigraphError);
				assert.equal(error.code, "invalid");
				assert.match(error.message, /no usable hash/);
				return true;
			},
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a body whose publication has no hash is not written to the cache", () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		assert.throws(
			() => writeCachedSkill(dir, entry({ sha256: "" }), "# The skill"),
			CachePathError,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a graph that answers another skill is not trusted", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		const source = new OmnigraphSkillSource({
			config: configOf(dir),
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						columns: [
							"id",
							"name",
							"description",
							"revision",
							"sha256",
							"instructions",
							"resources_json",
						],
						rows: [
							[
								"another-skill",
								"another-skill",
								"a skill of the graph",
								"abc123",
								omnigraphInstructionsHash("# Another"),
								"# Another",
								"[]",
							],
						],
					}),
					{ status: 200 },
				),
		});
		await assert.rejects(
			() => source.get("the-skill"),
			(error) => {
				assert.equal(error.code, "invalid");
				return true;
			},
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- P1: the cache of a source belongs to that source -----------------------

test("two sources have two caches", () => {
	const base = tempDir("omnigraph-review-cache-");
	try {
		const first = readOmnigraphConfig({
			OMNIGRAPH_URL: "https://one.example",
			OMNIGRAPH_SKILLS_TOKEN: "token-one",
			OMNIGRAPH_CACHE_DIR: base,
		});
		const other = readOmnigraphConfig({
			OMNIGRAPH_URL: "https://two.example",
			OMNIGRAPH_SKILLS_TOKEN: "token-one",
			OMNIGRAPH_CACHE_DIR: base,
		});
		const otherReader = readOmnigraphConfig({
			OMNIGRAPH_URL: "https://one.example",
			OMNIGRAPH_SKILLS_TOKEN: "token-two",
			OMNIGRAPH_CACHE_DIR: base,
		});
		assert.ok(first && other && otherReader);
		assert.notEqual(first.cacheDir, other.cacheDir);
		assert.notEqual(first.cacheDir, otherReader.cacheDir);
		assert.ok(first.cacheDir.startsWith(base));
		assert.notEqual(
			cacheNamespace({
				url: "https://one.example",
				graph: "skills",
				token: "token-one",
			}),
			cacheNamespace({
				url: "https://one.example",
				graph: "skills",
				token: "token-two",
			}),
		);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("a graph that refuses the read never serves the catalog of another read", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		// The cache of the source holds a verified catalog.
		writeCatalog(dir, [entry()]);
		const pi = fakePi();
		registerOmnigraphSkills(pi, {
			config: configOf(dir),
			source: sourceOf({
				catalogError: new OmnigraphError("the server refused the read", "denied"),
			}),
			log: () => {},
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "",
		});
		const text = textOf(answer);
		assert.match(text, /refused the read/);
		assert.ok(!text.includes("the-skill"), "the refused graph served a catalog");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a graph that cannot be reached serves the catalog of the last verified read of the same source", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		writeCatalog(dir, [entry()]);
		const pi = fakePi();
		registerOmnigraphSkills(pi, {
			config: configOf(dir),
			source: sourceOf({
				catalogError: new OmnigraphError("the server is not reachable", "unavailable"),
			}),
			log: () => {},
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "",
		});
		const text = textOf(answer);
		assert.match(text, /could not be reached/);
		assert.match(text, /the-skill/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- P2: the discovery does not race the catalog ----------------------------

test("the discovery finds the stubs of the first read of the catalog", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		const pi = fakePi();
		registerOmnigraphSkills(pi, {
			config: configOf(dir),
			source: sourceOf(),
			log: () => {},
		});
		const handler = pi.handlers.get("resources_discover");
		assert.ok(handler, "the discovery of the resources was not registered");
		const result = await handler({
			type: "resources_discover",
			cwd: "/",
			reason: "startup",
		});
		assert.equal(result.skillPaths.length, 1);
		assert.ok(
			existsSync(join(stubRoot(dir), "the-skill", "SKILL.md")),
			"the discovery returned before the stubs were written",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the discovery finds the stubs of the last verified read without the network", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		writeCatalog(dir, [entry()]);
		const pi = fakePi();
		registerOmnigraphSkills(pi, {
			config: configOf(dir),
			source: sourceOf({
				catalogError: new OmnigraphError("the server is not reachable", "unavailable"),
			}),
			log: () => {},
		});
		const handler = pi.handlers.get("resources_discover");
		const result = await handler({
			type: "resources_discover",
			cwd: "/",
			reason: "startup",
		});
		assert.equal(result.skillPaths.length, 1);
		assert.ok(existsSync(join(stubRoot(dir), "the-skill", "SKILL.md")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- P2: a file belongs to the revision it was published with --------------

test("a file of another revision is not fetched", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		const pi = fakePi();
		let fetched = false;
		registerOmnigraphSkills(pi, {
			config: configOf(dir),
			source: sourceOf({
				record: {
					id: "the-skill",
					name: "the-skill",
					description: "a skill of the graph",
					revision: "abc123",
					sha256: "a".repeat(64),
					instructions: "# The skill",
					resourcesJson: JSON.stringify([
						{
							path: "reference.md",
							bytes: 4,
							sha256: sha256Of("abcd"),
							revision: "another-revision",
						},
					]),
				},
			}),
			fetcher: {
				async fetch() {
					fetched = true;
					return new TextEncoder().encode("abcd");
				},
			},
			log: () => {},
		});
		const answer = await toolOf(pi, "remote_skill_resource").execute("call", {
			id: "the-skill",
			path: "reference.md",
		});
		assert.match(textOf(answer), /belongs to the revision/);
		assert.ok(!fetched, "the file of another revision was fetched");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a file of the revision that was asked for is fetched", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		const pi = fakePi();
		registerOmnigraphSkills(pi, {
			config: configOf(dir),
			source: sourceOf({
				record: {
					id: "the-skill",
					name: "the-skill",
					description: "a skill of the graph",
					revision: "abc123",
					sha256: "a".repeat(64),
					instructions: "# The skill",
					resourcesJson: JSON.stringify([
						{ path: "reference.md", bytes: 4, sha256: sha256Of("abcd") },
					]),
				},
			}),
			fetcher: {
				async fetch() {
					return new TextEncoder().encode("abcd");
				},
			},
			log: () => {},
		});
		const answer = await toolOf(pi, "remote_skill_resource").execute("call", {
			id: "the-skill",
			path: "reference.md",
			revision: "abc123",
		});
		assert.match(textOf(answer), /reference\.md/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- P2: the limits are enforced -------------------------------------------

test("the cache refuses a write that does not fit its budget", () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		writeCatalog(dir, [entry()]);
		assert.throws(() => makeRoomInCache(dir, 1, 4096), CachePathError);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an answer that arrives in pieces is measured in bytes", async () => {
	const chunk = new TextEncoder().encode("x".repeat(100));
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(chunk);
			controller.enqueue(chunk);
			controller.close();
		},
	});
	await assert.rejects(
		() =>
			omnigraphQuery({
				url: "https://graph.example",
				graph: "skills",
				query: "skill_catalog",
				token: "t",
				apiVersion: "0.14",
				timeoutMs: 1000,
				maxBytes: 150,
				fetchImpl: async () => new Response(stream, { status: 200 }),
			}),
		(error) => {
			assert.equal(error.code, "invalid");
			return true;
		},
	);
});

test("an answer of many characters is measured in bytes, not in characters", async () => {
	// Ten characters of three bytes each: the length is under the bound,
	// the size is over it.
	const answer = JSON.stringify({ columns: ["id"], rows: [["€".repeat(10)]] });
	await assert.rejects(
		() =>
			omnigraphQuery({
				url: "https://graph.example",
				graph: "skills",
				query: "skill_catalog",
				token: "t",
				apiVersion: "0.14",
				timeoutMs: 1000,
				maxBytes: 20,
				fetchImpl: async () => new Response(answer, { status: 200 }),
			}),
		(error) => {
			assert.equal(error.code, "invalid");
			return true;
		},
	);
});

// --- the small gaps of the source -------------------------------------------

test("the description of a skill with a colon does not break the stub", () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		writeStubs(dir, [
			entry({
				id: "the-skill",
				name: "the-skill",
				description: "the grid of a frappe site: it is fast\nand it is useful",
			}),
		]);
		const markdown = readFileSync(
			join(stubRoot(dir), "the-skill", "SKILL.md"),
			"utf8",
		);
		const frontmatter = markdown.split("---")[1] ?? "";
		assert.match(
			frontmatter,
			/description: "the grid of a frappe site: it is fast and it is useful"/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a manifest that cannot be read is reported, not hidden", async () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		const pi = fakePi();
		registerOmnigraphSkills(pi, {
			config: configOf(dir),
			source: sourceOf({
				record: {
					id: "the-skill",
					name: "the-skill",
					description: "a skill of the graph",
					revision: "abc123",
					sha256: sha256Of("# The skill"),
					instructions: "# The skill",
					resourcesJson: "not json at all",
				},
			}),
			log: () => {},
		});
		const answer = await toolOf(pi, "remote_skill_load").execute("call", {
			id: "the-skill",
		});
		assert.match(textOf(answer), /manifest of the files could not be read/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the stub of the graph is read by the reader of pi", () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		writeStubs(dir, [
			entry({
				id: "the-skill",
				name: "the: skill",
				description: "a description: with a colon\nand a line",
			}),
		]);
		const result = loadSkillsFromDir({ dir: stubRoot(dir), source: "user" });
		assert.equal(result.skills.length, 1);
		const warnings = result.diagnostics.filter(
			(diagnostic) => diagnostic.type === "warning",
		);
		assert.deepEqual(warnings, [], "the reader of pi complained about the stub");
		assert.equal(result.skills[0].name, "the-skill");
		assert.match(result.skills[0].description, /a description: with a colon/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("two skills of the graph with the same name get two stubs", () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		writeStubs(dir, [
			entry({ id: "one", name: "the-skill" }),
			entry({ id: "two", name: "the-skill" }),
		]);
		const result = loadSkillsFromDir({ dir: stubRoot(dir), source: "user" });
		assert.equal(result.skills.length, 2);
		const names = result.skills.map((skill) => skill.name);
		assert.equal(new Set(names).size, 2, "the two stubs share a name");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the catalog of the source holds only the skills of that source", () => {
	const dir = tempDir("omnigraph-review-cache-");
	try {
		writeCatalog(dir, [entry()]);
		const read = readCatalog(dir);
		assert.equal(read.length, 1);
		assert.equal(read[0].id, "the-skill");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
