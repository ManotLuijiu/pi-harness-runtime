/**
 * The retrieval of the skills in the runtime.
 *
 * The registration is the one entry point of the search: the tool and the
 * command use the shared retrieval, and the graph stays the authority. The
 * tests are behavioural: they drive the tool and the command and count what
 * the vector provider was asked for, because the symptom of a wrong
 * integration is a provider that is never called or a candidate that is not
 * verified.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeCatalog } from "../harness/omnigraph/cache.ts";
import { writeIndexManifest } from "../harness/skill-index-sync.ts";
import { registerOmnigraphSkills } from "../harness/omnigraph/registration.ts";

/** A directory of a test. */
function tempDir(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
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

/** A catalog of two skills. */
function catalog() {
	return [
		{
			id: "sk-deploy",
			name: "deploy",
			description: "ship a release to production",
			revision: "pub-2",
			sha256: "a".repeat(64),
		},
		{
			id: "sk-review",
			name: "review",
			description: "read a diff and judge it",
			revision: "pub-2",
			sha256: "b".repeat(64),
		},
	];
}

/**
 * The registration of a test.
 *
 * The source is a fake one: the catalog of the test is already in the cache,
 * and the source refuses nothing.
 */
function register(dir, options = {}) {
	const pi = fakePi();
	registerOmnigraphSkills(pi, {
		config: configOf(dir),
		source: {
			catalog: async () => catalog(),
			get: async () => null,
		},
		log: () => {},
		...options,
	});
	return pi;
}

test("the tool answers with the candidates of the shared retrieval", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir);
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "deploy",
		});
		const text = textOf(answer);
		assert.match(text, /deploy \(sk-deploy\)/);
		assert.match(text, /revision pub-2/);
		assert.equal(answer.details.mode, "lexical");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the status names the mode of the retrieval", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir);
		const command = pi.commands.find((item) => item.name === "remote-skills");
		assert.ok(command, "the command was not registered");
		const lines = [];
		await command.handler("status", {
			ui: { notify: (message) => lines.push(message) },
			log: (message) => lines.push(message),
		});
		const text = lines.join("\n");
		assert.match(text, /retrieval runs on the catalog of the graph alone/);
		assert.match(text, /off by default/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the stage off never asks the index for its candidates", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		let calls = 0;
		const pi = register(dir, {
			vectorSearch: async () => {
				calls += 1;
				return [{ id: "sk-review", score: 0.9 }];
			},
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "diff",
		});
		assert.equal(calls, 0, "the index stays untouched while the stage is off");
		assert.equal(answer.details.mode, "lexical");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the shadow compares the index with the lexical search and leaves its candidates out", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		let calls = 0;
		const pi = register(dir, {
			rolloutStage: "shadow",
			vectorSearch: async () => {
				calls += 1;
				return [{ id: "sk-review", score: 0.9 }];
			},
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "diff",
		});
		assert.equal(calls, 1, "the index is asked for the comparison");
		assert.equal(answer.details.mode, "lexical");
		assert.match(textOf(answer), /review \(sk-review\)/);
		assert.match(
			answer.details.reasons?.shadow ?? "",
			/index would have added/,
		);
		assert.match(textOf(answer), /its candidates did not enter the answer/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the vector provider is asked once and its hits join the answer", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		let calls = 0;
		const pi = register(dir, {
			rolloutStage: "pilot",
			vectorSearch: async (query, limit) => {
				calls += 1;
				assert.equal(query, "diff");
				assert.ok(limit > 0);
				return [{ id: "sk-review", score: 0.9 }];
			},
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "diff",
		});
		assert.equal(calls, 1, "the provider was asked exactly once");
		const text = textOf(answer);
		assert.match(text, /review \(sk-review\)/);
		assert.equal(answer.details.mode, "hybrid");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a stale hit of the index is answered with the revision of the graph", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir, {
			rolloutStage: "pilot",
			vectorSearch: async () => [
				{ id: "sk-review", score: 0.9, revision: "pub-1" },
			],
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "diff",
		});
		const text = textOf(answer);
		assert.match(text, /revision pub-2/, "the revision of the graph is the one that answers");
		assert.doesNotMatch(text, /revision pub-1/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an index that cannot be read degrades the search and says so", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir, {
			rolloutStage: "pilot",
			vectorSearch: async () => {
				throw new Error("the cluster is not reachable");
			},
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "diff",
		});
		const text = textOf(answer);
		assert.match(text, /could not be read/);
		assert.match(text, /review \(sk-review\)/, "the catalog of the graph still answers");
		assert.equal(answer.details.mode, "lexical");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a skill of a revision that is not approved is not answered", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir, { approvedRevision: "pub-1" });
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "diff",
		});
		const text = textOf(answer);
		assert.doesNotMatch(text, /review \(sk-review\)/);
		assert.match(text, /no skill that fits/);
		assert.equal(answer.details.excluded, 0, "the skill is not even a candidate");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the status names the active index generation and its lag", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		writeIndexManifest(dir, {
			schemaVersion: 1,
			namespace: "org-a",
			graph: "skills",
			sourceSnapshot: "digest-1",
			embeddingModel: "text-embedding-3-small",
			embeddingDimensions: 1536,
			indexedCount: 5,
			runId: "run-7",
			state: "active",
			createdAt: "2026-11-27T00:00:00.000Z",
			activatedAt: "2026-11-27T00:00:00.000Z",
		});
		const pi = register(dir);
		const command = pi.commands.find((item) => item.name === "remote-skills");
		const lines = [];
		await command.handler("status", {
			ui: { notify: (message) => lines.push(message) },
			log: (message) => lines.push(message),
		});
		const text = lines.join("\n");
		assert.match(text, /active index generation "run-7"/);
		assert.match(text, /holds 5 record\(s\)/);
		assert.match(text, /behind the source/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the status names the reason the last search degraded", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir, {
			rolloutStage: "pilot",
			vectorSearch: async () => {
				throw new Error("the cluster is not reachable");
			},
		});
		await toolOf(pi, "remote_skill_search").execute("call", { query: "diff" });
		const command = pi.commands.find((item) => item.name === "remote-skills");
		const lines = [];
		await command.handler("status", {
			ui: { notify: (message) => lines.push(message) },
			log: (message) => lines.push(message),
		});
		const text = lines.join("\n");
		assert.match(text, /last search degraded/);
		assert.match(text, /could not be read/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a mandatory prerequisite of a candidate joins the answer", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir, {
			relationReader: {
				async neighbors(identity) {
					return identity === "sk-deploy"
						? [
								{
									from: "sk-deploy",
									to: "sk-review",
									type: "requires",
									provenance: "published",
									revision: "pub-2",
								},
							]
						: [];
				},
			},
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "deploy",
		});
		const text = textOf(answer);
		assert.match(text, /deploy \(sk-deploy\)/);
		assert.match(text, /review \(sk-review\)/, "the prerequisite joins the answer");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a prerequisite that the graph does not hold is named, not returned", async () => {
	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir, {
			relationReader: {
				async neighbors() {
					return [
						{
							from: "sk-deploy",
							to: "sk-ghost",
							type: "requires",
							provenance: "published",
							revision: "pub-2",
						},
					];
				},
			},
		});
		const answer = await toolOf(pi, "remote_skill_search").execute("call", {
			query: "deploy",
		});
		const text = textOf(answer);
		assert.doesNotMatch(text, /sk-ghost/, "the skill is not returned");
		assert.equal(answer.details.relations?.missing.length, 1);
		assert.equal(answer.details.relations?.missing[0].identity, "sk-ghost");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the command searches with the same retrieval", async () => {	const dir = tempDir("omnigraph-retrieval-");
	try {
		writeCatalog(dir, catalog());
		const pi = register(dir);
		const command = pi.commands.find((item) => item.name === "remote-skills");
		const lines = [];
		await command.handler("search deploy", {
			ui: { notify: (message) => lines.push(message) },
			log: (message) => lines.push(message),
		});
		assert.match(lines.join("\n"), /deploy \(sk-deploy\)/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
