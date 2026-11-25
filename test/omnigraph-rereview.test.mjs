/**
 * The regressions of the re-review of the OmniGraph source.
 *
 * Every test here reproduces a finding of the re-review and proves that
 * the finding is closed:
 *
 * - the approval of the operator is enforced on the production path, not
 *   only in the name of the cache,
 * - a source that refuses the credential advertises nothing through the
 *   native discovery of pi,
 * - the budget of the cache bounds the instructions, the catalog and the
 *   stubs, not only the supporting files.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cacheUsage, stubRoot } from "../harness/omnigraph/cache.ts";
import { readOmnigraphConfig } from "../harness/omnigraph/config.ts";
import { omnigraphInstructionsHash } from "../harness/omnigraph/source.ts";
import { initOmnigraphSkills } from "../harness/omnigraph/startup.ts";

/** A directory of a test. */
function tempDir(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
}

/** A pi that records what an extension registers. */
function fakePi() {
	const tools = [];
	const handlers = new Map();
	return {
		tools,
		handlers,
		on(event, handler) {
			handlers.set(event, handler);
		},
		registerTool(tool) {
			tools.push(tool);
		},
		registerCommand() {},
	};
}

/** The tool of the source with that name. */
function toolOf(pi, name) {
	const tool = pi.tools.find((candidate) => candidate.name === name);
	assert.ok(tool, `the tool "${name}" is not registered`);
	return tool;
}

/** The environment of a machine with the graph configured. */
function configuredEnv(cacheDir, extra = {}) {
	return {
		HOME: "/home/tester",
		OMNIGRAPH_URL: "https://graph.example",
		OMNIGRAPH_SKILLS_TOKEN: "the-token-of-the-reader",
		OMNIGRAPH_SOURCE_MODE: "omnigraph",
		OMNIGRAPH_CACHE_DIR: cacheDir,
		...extra,
	};
}

/** The rows the startup wrote. */
function recorder() {
	const rows = [];
	return {
		rows,
		insert: (anchor, label, text, status, details) => {
			rows.push({ anchor, label, text, status, details });
		},
	};
}

/** The answer of the catalog of a graph that holds one skill. */
function catalogAnswer(revision) {
	return JSON.stringify({
		columns: ["id", "name", "description", "revision", "sha256"],
		rows: [
			[
				"the-skill",
				"the-skill",
				"a skill of the graph",
				revision,
				omnigraphInstructionsHash("# The skill"),
			],
		],
	});
}

/** The answer of the record of the skill. */
function recordAnswer(revision, instructions) {
	return JSON.stringify({
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
				revision,
				omnigraphInstructionsHash(instructions),
				instructions,
				"[]",
			],
		],
	});
}

/**
 * A reader that answers the two stored queries of the source.
 */
function readerOf(answers) {
	return async (request) => {
		const url = String(request?.url ?? "");
		const answer = url.includes("skill_catalog")
			? answers.catalog
			: answers.record;
		return new Response(answer, { status: answers.status ?? 200 });
	};
}

// --- P1: the approval of the environment is enforced ------------------------

test("a skill of another revision does not load when the environment approves one", async () => {
	const dir = tempDir("omnigraph-rereview-");
	try {
		const pi = fakePi();
		const startup = initOmnigraphSkills(pi, {
			env: configuredEnv(dir, {
				OMNIGRAPH_APPROVED_REVISION: "approved-revision",
			}),
			insert: recorder().insert,
			log: () => {},
			saasConfigured: false,
			fetchImpl: readerOf({
				catalog: catalogAnswer("different-revision"),
				record: recordAnswer("different-revision", "# The skill"),
			}),
		});
		await startup.ready;

		const load = toolOf(pi, "remote_skill_load");
		const answer = await load.execute("call-1", { id: "the-skill" });
		assert.equal(
			answer.details.directory,
			"",
			"the body of another revision was written",
		);
		assert.match(answer.content[0].text, /approved revision/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a skill of the approved revision loads when the environment approves it", async () => {
	const dir = tempDir("omnigraph-rereview-");
	try {
		const pi = fakePi();
		const startup = initOmnigraphSkills(pi, {
			env: configuredEnv(dir, {
				OMNIGRAPH_APPROVED_REVISION: "approved-revision",
			}),
			insert: recorder().insert,
			log: () => {},
			saasConfigured: false,
			fetchImpl: readerOf({
				catalog: catalogAnswer("approved-revision"),
				record: recordAnswer("approved-revision", "# The skill"),
			}),
		});
		await startup.ready;

		const load = toolOf(pi, "remote_skill_load");
		const answer = await load.execute("call-1", { id: "the-skill" });
		assert.notEqual(answer.details.directory, "");
		assert.equal(answer.details.revision, "approved-revision");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the approval of the environment is not advertised as another revision", async () => {
	const dir = tempDir("omnigraph-rereview-");
	try {
		const pi = fakePi();
		const startup = initOmnigraphSkills(pi, {
			env: configuredEnv(dir, {
				OMNIGRAPH_APPROVED_REVISION: "approved-revision",
			}),
			insert: recorder().insert,
			log: () => {},
			saasConfigured: false,
			fetchImpl: readerOf({
				catalog: catalogAnswer("different-revision"),
				record: recordAnswer("different-revision", "# The skill"),
			}),
		});
		await startup.ready;

		const search = toolOf(pi, "remote_skill_search");
		const answer = await search.execute("call-1", { query: "the-skill" });
		assert.doesNotMatch(answer.content[0].text, /the-skill/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- P2: a refused source advertises nothing -------------------------------

test("a source that refuses the credential advertises no skill", async () => {
	const dir = tempDir("omnigraph-rereview-");
	try {
		// The first session reads the graph: the stubs are written.
		const first = fakePi();
		const firstStartup = initOmnigraphSkills(first, {
			env: configuredEnv(dir),
			insert: recorder().insert,
			log: () => {},
			saasConfigured: false,
			fetchImpl: readerOf({
				catalog: catalogAnswer("abc123"),
				record: recordAnswer("abc123", "# The skill"),
			}),
		});
		await firstStartup.ready;
		const config = readOmnigraphConfig(configuredEnv(dir));
		assert.ok(config, "the configuration was not read");
		const stub = join(stubRoot(config.cacheDir), "the-skill", "SKILL.md");
		assert.ok(existsSync(stub), "the stub of the first read is missing");

		// The second session has the same cache and a refused
		// credential: the private names of the skills of the graph may
		// not be advertised any more.
		const second = fakePi();
		const secondStartup = initOmnigraphSkills(second, {
			env: configuredEnv(dir),
			insert: recorder().insert,
			log: () => {},
			saasConfigured: false,
			fetchImpl: readerOf({
				catalog: "",
				record: "",
				status: 403,
			}),
		});
		await secondStartup.ready;
		const report = await secondStartup.ready;
		assert.equal(
			report.state,
			"denied",
			"the refused source is not reported as denied",
		);
		assert.equal(report.count, 0, "the refused source reports a skill");

		const discovery = second.handlers.get("resources_discover");
		assert.ok(discovery, "the discovery of the source is not registered");
		const found = await discovery();
		assert.deepEqual(
			found.skillPaths,
			[],
			"the stubs of a refused source are advertised",
		);
		assert.equal(
			existsSync(stub),
			false,
			"the stub of a refused source is still on the disk",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- P2: the budget of the cache bounds the instructions -------------------

test("the instructions of a skill do not pass the budget of the cache", async () => {
	const dir = tempDir("omnigraph-rereview-");
	try {
		const instructions = "# The skill\n" + "x".repeat(20_000);
		const pi = fakePi();
		const startup = initOmnigraphSkills(pi, {
			env: configuredEnv(dir, {
				OMNIGRAPH_CACHE_BUDGET_BYTES: "8192",
			}),
			insert: recorder().insert,
			log: () => {},
			saasConfigured: false,
			fetchImpl: readerOf({
				catalog: catalogAnswer("abc123"),
				record: recordAnswer("abc123", instructions),
			}),
		});
		await startup.ready;

		const load = toolOf(pi, "remote_skill_load");
		const answer = await load.execute("call-1", { id: "the-skill" });
		assert.equal(
			answer.details.directory,
			"",
			"the body was written although it does not fit the budget",
		);
		const config = readOmnigraphConfig(
			configuredEnv(dir, { OMNIGRAPH_CACHE_BUDGET_BYTES: "8192" }),
		);
		assert.ok(config, "the configuration was not read");
		assert.ok(
			cacheUsage(config.cacheDir) <= 8192,
			`the cache holds ${cacheUsage(config.cacheDir)} bytes`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the catalog and the stubs of the source do not pass the budget of the cache", async () => {
	const dir = tempDir("omnigraph-rereview-");
	try {
		const pi = fakePi();
		const startup = initOmnigraphSkills(pi, {
			env: configuredEnv(dir, {
				OMNIGRAPH_CACHE_BUDGET_BYTES: "512",
			}),
			insert: recorder().insert,
			log: () => {},
			saasConfigured: false,
			fetchImpl: readerOf({
				catalog: catalogAnswer("abc123"),
				record: recordAnswer("abc123", "# The skill"),
			}),
		});
		await startup.ready;

		const config = readOmnigraphConfig(
			configuredEnv(dir, { OMNIGRAPH_CACHE_BUDGET_BYTES: "512" }),
		);
		assert.ok(config, "the configuration was not read");
		assert.ok(
			cacheUsage(config.cacheDir) <= 512,
			`the cache holds ${cacheUsage(config.cacheDir)} bytes`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
