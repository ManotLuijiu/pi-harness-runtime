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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

test("a machine without the graph gets the row that says how to configure it", () => {
	const pi = fakePi();
	const sink = recorder();
	initOmnigraphSkills(pi, {
		insert: sink.insert,
		log: () => {},
		saasConfigured: false,
		env: { HOME: "/home/tester" },
	});
	assert.equal(sink.rows.length, 1);
	const row = sink.rows[0];
	assert.equal(row.label, "Omnigraph");
	assert.equal(row.status, "info");
	assert.equal(row.anchor, "Qdrant");
	assert.match(row.text, /not configured/);
	const details = row.details.join("\n");
	assert.match(details, /OMNIGRAPH_URL/);
	assert.match(details, /OMNIGRAPH_SKILLS_TOKEN/);
	assert.match(details, /omnigraph-skills-token\.txt/);
	assert.match(details, /set OMNIGRAPH_SOURCE_MODE=omnigraph/);
	// The row does not promise the tools of the graph: they are not
	// registered on a machine that does not read the graph.
	assert.match(details, /its tools are not registered/);
	assert.equal(pi.commands.length, 0);
	// The graph is not the source of this machine: no tool, no command.
	assert.equal(pi.tools.length, 0);
});

test("a graph that is turned off on purpose says so, and names the way back", () => {
	const pi = fakePi();
	const sink = recorder();
	initOmnigraphSkills(pi, {
		insert: sink.insert,
		log: () => {},
		saasConfigured: false,
		env: { HOME: "/home/tester", OMNIGRAPH_SOURCE_MODE: "off" },
	});
	assert.equal(sink.rows.length, 1);
	const row = sink.rows[0];
	assert.equal(row.status, "info");
	assert.match(row.text, /disabled/);
	assert.match(row.details.join("\n"), /OMNIGRAPH_SOURCE_MODE=off/);
	assert.equal(pi.tools.length, 0);
});

test("a source that is on, but not configured, is reported and stays next to Qdrant", () => {
	const pi = fakePi();
	const sink = recorder();
	const startup = initOmnigraphSkills(pi, {
		insert: sink.insert,
		log: () => {},
		saasConfigured: false,
		env: { HOME: "/home/tester", OMNIGRAPH_SOURCE_MODE: "omnigraph" },
	});
	const row = sink.rows[0];
	assert.equal(row.label, "Omnigraph");
	assert.equal(row.status, "warn");
	assert.match(row.text, /endpoint or the credential is missing/);
	assert.match(row.details.join("\n"), /OMNIGRAPH_URL/);
	assert.match(row.details.join("\n"), /OMNIGRAPH_SKILLS_TOKEN/);
	// The row is placed again when the row of Qdrant appears.
	startup.placeRow("Qdrant");
	const last = sink.rows[sink.rows.length - 1];
	assert.equal(last.anchor, "Qdrant");
	assert.equal(last.status, "warn");
	// The graph is not read: no tool, no command.
	assert.equal(pi.tools.length, 0);
});

test("the row names the part of the configuration that is missing", () => {
	const withoutEndpoint = fakePi();
	const endpointSink = recorder();
	initOmnigraphSkills(withoutEndpoint, {
		insert: endpointSink.insert,
		log: () => {},
		saasConfigured: false,
		env: { HOME: "/home/tester", OMNIGRAPH_SKILLS_TOKEN: "the-token" },
	});
	const endpointDetails = endpointSink.rows[0].details.join("\n");
	assert.match(endpointDetails, /set OMNIGRAPH_URL/);
	assert.doesNotMatch(endpointDetails, /set OMNIGRAPH_SKILLS_TOKEN/);

	const withoutCredential = fakePi();
	const credentialSink = recorder();
	initOmnigraphSkills(withoutCredential, {
		insert: credentialSink.insert,
		log: () => {},
		saasConfigured: false,
		env: { HOME: "/home/tester", OMNIGRAPH_URL: "https://graph.example" },
	});
	const credentialDetails = credentialSink.rows[0].details.join("\n");
	assert.match(credentialDetails, /set OMNIGRAPH_SKILLS_TOKEN/);
	assert.doesNotMatch(credentialDetails, /set OMNIGRAPH_URL/);
	// The endpoint that is already there is named, not asked for.
	assert.match(credentialDetails, /The endpoint of the graph is set at https:\/\/graph\.example/);
});

test("the row of a machine without the graph stays next to the row of Qdrant", () => {
	const pi = fakePi();
	const sink = recorder();
	const startup = initOmnigraphSkills(pi, {
		insert: sink.insert,
		log: () => {},
		saasConfigured: false,
		env: { HOME: "/home/tester" },
	});
	// The row of Qdrant appears later: the row of the graph is placed
	// next to it, not at the end of the summary.
	startup.placeRow("Qdrant");
	const last = sink.rows[sink.rows.length - 1];
	assert.equal(last.anchor, "Qdrant");
	assert.equal(last.label, "Omnigraph");
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
	assert.equal(row.anchor, "Qdrant");
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

test("the skill service of the harness keeps the place when the graph is not configured", () => {
	const pi = fakePi();
	const sink = recorder();
	initOmnigraphSkills(pi, {
		insert: sink.insert,
		log: () => {},
		saasConfigured: true,
		env: { HOME: "/home/tester", OMNIGRAPH_SOURCE_MODE: "saas" },
	});
	const row = sink.rows[0];
	assert.equal(row.label, "Omnigraph");
	// The graph is not the source of this machine and it is optional: the
	// row is an information, not a warning about a source that is on.
	assert.equal(row.status, "info");
	assert.doesNotMatch(row.text, /endpoint or the credential is missing/);
	assert.match(row.text, /skill service of the harness/);
	const details = row.details.join("\n");
	assert.match(details, /OMNIGRAPH_URL/);
	assert.match(details, /OMNIGRAPH_SKILLS_TOKEN/);
	// The advice to make the graph the source is complete: the mode
	// alone cannot work without the endpoint and the credential.
	assert.match(
		details,
		/set OMNIGRAPH_SOURCE_MODE=omnigraph, with the endpoint and the credential of the reader/,
	);
	assert.equal(pi.tools.length, 0);
});

test("a turned-off row names what is missing and the way back", () => {
	const pi = fakePi();
	const sink = recorder();
	initOmnigraphSkills(pi, {
		insert: sink.insert,
		log: () => {},
		saasConfigured: false,
		env: { HOME: "/home/tester", OMNIGRAPH_SOURCE_MODE: "off" },
	});
	const details = sink.rows[0].details.join("\n");
	assert.match(details, /set OMNIGRAPH_URL/);
	assert.match(details, /set OMNIGRAPH_SKILLS_TOKEN/);
	assert.match(details, /remove OMNIGRAPH_SOURCE_MODE=off/);
});

test("a turned-off row does not ask for what is already set", () => {
	const home = mkdtempSync(join(tmpdir(), "omnigraph-home-"));
	try {
		// The credential of the reader is in the key file of the machine:
		// the row must not ask for it again.
		const keyDir = join(home, ".pi-harness-runtime", "keys");
		mkdirSync(keyDir, { recursive: true });
		writeFileSync(join(keyDir, "omnigraph-skills-token.txt"), "the-token\n");
		const pi = fakePi();
		const sink = recorder();
		initOmnigraphSkills(pi, {
			insert: sink.insert,
			log: () => {},
			saasConfigured: false,
			env: {
				HOME: home,
				OMNIGRAPH_URL: "https://graph.example",
				OMNIGRAPH_SOURCE_MODE: "off",
			},
		});
		const details = sink.rows[0].details.join("\n");
		assert.match(
			details,
			/The endpoint of the graph is set at https:\/\/graph\.example/,
		);
		assert.match(details, /The credential of the reader is set/);
		assert.doesNotMatch(details, /set OMNIGRAPH_URL/);
		assert.doesNotMatch(details, /set OMNIGRAPH_SKILLS_TOKEN/);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
