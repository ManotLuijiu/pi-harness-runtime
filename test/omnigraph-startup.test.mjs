/**
 * Tests for the startup of the OmniGraph source.
 *
 * The row of the graph is the way the user learns that the machine reads
 * a graph: it names the endpoint, next to the rows of the other services.
 * The tools and the command are registered at the same time, and the
 * registration does not wait for the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initOmnigraphSkills } from "../harness/omnigraph/startup.ts";

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

/** The answer of the catalog of a graph with one skill. */
function catalogAnswer() {
	return JSON.stringify({
		columns: ["id", "name", "description", "revision", "sha256"],
		rows: [["the-skill", "the-skill", "a skill of the graph", "abc123", ""]],
	});
}

/** The environment of a machine with the graph configured. */
function configuredEnv(cacheDir) {
	return {
		HOME: "/home/tester",
		OMNIGRAPH_URL: "https://graph.example",
		OMNIGRAPH_SKILLS_TOKEN: "the-token-of-the-reader",
		OMNIGRAPH_CACHE_DIR: cacheDir,
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

test("the row of the graph names the endpoint that is read", async () => {
	const cacheDir = mkdtempSync(join(tmpdir(), "omnigraph-startup-"));
	try {
		const pi = fakePi();
		const sink = recorder();
		const env = configuredEnv(cacheDir);
		const startup = initOmnigraphSkills(pi, {
			insert: sink.insert,
			log: () => {},
			saasConfigured: false,
			env,
			fetchImpl: async () => new Response(catalogAnswer(), { status: 200 }),
		});
		// The row is placed next to the row of Qdrant, once the state of
		// the source is known.
		await startup.ready;
		startup.placeRow("Qdrant");
		const row = sink.rows.find((entry) => entry.label === "Omnigraph");
		assert.ok(row, "the startup wrote no row for the graph");
		assert.match(row.text, /https:\/\/graph\.example/);
		assert.equal(row.status, "ok");
		assert.equal(row.anchor, "Qdrant");
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

test("the tools and the command of the graph are registered", () => {
	const cacheDir = mkdtempSync(join(tmpdir(), "omnigraph-startup-"));
	try {
		const pi = fakePi();
		initOmnigraphSkills(pi, {
			insert: () => {},
			log: () => {},
			saasConfigured: false,
			env: configuredEnv(cacheDir),
		});
		const names = pi.tools.map((tool) => tool.name);
		assert.ok(names.includes("remote_skill_search"));
		assert.ok(names.includes("remote_skill_load"));
		assert.ok(names.includes("remote_skill_resource"));
		assert.ok(pi.commands.some((command) => command.name === "remote-skills"));
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

test("the skills of the graph are discovered natively, as stubs", async () => {
	const cacheDir = mkdtempSync(join(tmpdir(), "omnigraph-startup-"));
	try {
		const pi = fakePi();
		initOmnigraphSkills(pi, {
			insert: () => {},
			log: () => {},
			saasConfigured: false,
			env: configuredEnv(cacheDir),
		});
		const handler = pi.handlers.get("resources_discover");
		assert.ok(handler, "the discovery of the resources was not registered");
		const result = await handler({
			type: "resources_discover",
			cwd: "/",
			reason: "startup",
		});
		assert.ok(Array.isArray(result.skillPaths));
		assert.equal(result.skillPaths.length, 1);
		assert.match(result.skillPaths[0], /stubs$/);
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

test("a machine without the graph gets no row and no tool", () => {
	const pi = fakePi();
	const sink = recorder();
	initOmnigraphSkills(pi, {
		insert: sink.insert,
		log: () => {},
		saasConfigured: false,
		env: { HOME: "/home/tester" },
	});
	assert.equal(sink.rows.length, 0);
	assert.equal(pi.tools.length, 0);
});

test("the skill service of the harness keeps the place, and the row says so", () => {
	const pi = fakePi();
	const sink = recorder();
	initOmnigraphSkills(pi, {
		insert: sink.insert,
		log: () => {},
		saasConfigured: true,
		env: configuredEnv("/tmp/omnigraph-startup-saas"),
	});
	const row = sink.rows.find((entry) => entry.label === "Omnigraph");
	assert.ok(row);
	assert.equal(row.status, "info");
	assert.match(row.text, /the skill service of the harness/);
	assert.equal(pi.tools.length, 0);
});

test("a graph that refuses the credential is reported, and is not ready", async () => {
	const cacheDir = mkdtempSync(join(tmpdir(), "omnigraph-startup-"));
	try {
		const pi = fakePi();
		const sink = recorder();
		const startup = initOmnigraphSkills(pi, {
			insert: sink.insert,
			log: () => {},
			saasConfigured: false,
			env: configuredEnv(cacheDir),
			fetchImpl: async () => new Response("{}", { status: 403 }),
		});
		await startup.ready;
		startup.placeRow("Qdrant");
		const row = sink.rows.find((entry) => entry.label === "Omnigraph");
		assert.ok(row);
		assert.equal(row.status, "warn");
		assert.match(row.text, /not ready/);
		assert.match(
			row.details.join(" "),
			/refused the read/,
		);
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

test("a graph that cannot be reached is reported, and is not ready", async () => {
	const cacheDir = mkdtempSync(join(tmpdir(), "omnigraph-startup-"));
	try {
		const pi = fakePi();
		const sink = recorder();
		const startup = initOmnigraphSkills(pi, {
			insert: sink.insert,
			log: () => {},
			saasConfigured: false,
			env: configuredEnv(cacheDir),
			fetchImpl: async () => {
				throw new Error("the network is down");
			},
		});
		await startup.ready;
		startup.placeRow("Qdrant");
		const row = sink.rows.find((entry) => entry.label === "Omnigraph");
		assert.ok(row);
		assert.equal(row.status, "warn");
		assert.match(row.text, /not ready/);
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});
