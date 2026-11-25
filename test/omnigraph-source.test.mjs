/**
 * Tests for the OmniGraph source: the configuration, the read of a
 * stored query and the source of the skills.
 *
 * The network is never reached: the transport takes the function that
 * performs the request, so the test answers with a fixture.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	normalizeOmnigraphUrl,
	readOmnigraphConfig,
	readOmnigraphSourceMode,
	redactOmnigraphSecret,
} from "../harness/omnigraph/config.ts";
import {
	columnText,
	OmnigraphError,
	omnigraphQuery,
	omnigraphQueryUrl,
	parseQueryResult,
} from "../harness/omnigraph/transport.ts";
import {
	OmnigraphSkillSource,
	omnigraphInstructionsHash,
} from "../harness/omnigraph/source.ts";

/** The answer of a stored query, as the server sends it. */
function queryAnswer({ columns, rows, row_count }) {
	return JSON.stringify({ columns, rows, row_count: row_count ?? rows.length });
}

/** A fetch that answers with the given answer, and records the request. */
function fetchWith(answer, options = {}) {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url, init });
		if (options.error) throw options.error;
		return new Response(answer, {
			status: options.status ?? 200,
			headers: { "content-type": "application/json" },
		});
	};
	return { impl, calls };
}

/** The configuration of a test. */
const CONFIG = {
	url: "https://graph.example",
	graph: "skills",
	token: "a-token-of-the-reader",
	apiVersion: "0.14",
	timeoutMs: 1000,
	catalogTimeoutMs: 500,
	cacheDir: "/tmp/omnigraph-test-cache",
	cacheBudgetBytes: 1024,
	maxAdvertisedSkills: 10,
};

// --- the configuration -----------------------------------------------------

test("the configuration needs the endpoint and the credential", () => {
	assert.equal(readOmnigraphConfig({}), undefined);
	assert.equal(
		readOmnigraphConfig({ OMNIGRAPH_URL: "https://graph.example" }),
		undefined,
	);
	assert.equal(
		readOmnigraphConfig({ OMNIGRAPH_SKILLS_TOKEN: "token" }),
		undefined,
	);
});

test("the endpoint loses its trailing slash", () => {
	assert.equal(
		normalizeOmnigraphUrl("https://graph.example/"),
		"https://graph.example",
	);
	assert.equal(
		normalizeOmnigraphUrl("https://graph.example///"),
		"https://graph.example",
	);
	const config = readOmnigraphConfig({
		OMNIGRAPH_URL: "https://graph.example/",
		OMNIGRAPH_SKILLS_TOKEN: "token",
	});
	assert.equal(config?.url, "https://graph.example");
	assert.equal(config?.graph, "skills");
	assert.equal(config?.apiVersion, "0.14");
});

test("a value of the configuration that is not a number is ignored", () => {
	const config = readOmnigraphConfig({
		OMNIGRAPH_URL: "https://graph.example",
		OMNIGRAPH_SKILLS_TOKEN: "token",
		OMNIGRAPH_TIMEOUT_MS: "not a number",
	});
	assert.equal(config?.timeoutMs, 15_000);
});

test("the mode of the source is a decision, not a guess", () => {
	// Nothing is configured: no remote source.
	assert.equal(readOmnigraphSourceMode({}), "off");
	// Only the graph is configured: the graph holds the skills.
	assert.equal(
		readOmnigraphSourceMode({
			OMNIGRAPH_URL: "https://graph.example",
			OMNIGRAPH_SKILLS_TOKEN: "token",
		}),
		"omnigraph",
	);
	// Both are configured: the service of the harness keeps the place,
	// so the behaviour of the machine does not change silently.
	assert.equal(
		readOmnigraphSourceMode(
			{
				OMNIGRAPH_URL: "https://graph.example",
				OMNIGRAPH_SKILLS_TOKEN: "token",
			},
			{ saasConfigured: true },
		),
		"saas",
	);
	// An explicit mode wins over both.
	assert.equal(
		readOmnigraphSourceMode(
			{
				OMNIGRAPH_URL: "https://graph.example",
				OMNIGRAPH_SKILLS_TOKEN: "token",
				OMNIGRAPH_SOURCE_MODE: "omnigraph",
			},
			{ saasConfigured: true },
		),
		"omnigraph",
	);
	assert.equal(
		readOmnigraphSourceMode({ OMNIGRAPH_SOURCE_MODE: "off" }, {
			saasConfigured: true,
		}),
		"off",
	);
});

test("a message never carries the credential", () => {
	const safe = redactOmnigraphSecret(
		"the server said: Bearer a-token-of-the-reader",
		"a-token-of-the-reader",
	);
	assert.ok(!safe.includes("a-token-of-the-reader"));
	assert.match(safe, /<redacted>/);
});

// --- the transport ---------------------------------------------------------

test("the route of a stored query is built from the endpoint and the graph", () => {
	assert.equal(
		omnigraphQueryUrl("https://graph.example/", "skills", "skill_catalog"),
		"https://graph.example/graphs/skills/queries/skill_catalog",
	);
});

test("the read sends the version of the contract and the credential", async () => {
	const { impl, calls } = fetchWith(
		queryAnswer({ columns: ["id"], rows: [["a"]] }),
	);
	await omnigraphQuery({
		url: "https://graph.example",
		graph: "skills",
		query: "skill_catalog",
		token: "a-token-of-the-reader",
		apiVersion: "0.14",
		timeoutMs: 1000,
		fetchImpl: impl,
	});
	assert.equal(calls.length, 1);
	const headers = calls[0].init.headers;
	assert.equal(headers.authorization, "Bearer a-token-of-the-reader");
	assert.equal(headers["omnigraph-http-api"], "0.14");
	assert.equal(headers["content-type"], "application/json");
	assert.equal(calls[0].init.body, JSON.stringify({ params: {} }));
});

test("a refusal of the server and an unreachable server stay apart", async () => {
	for (const status of [401, 403, 404]) {
		const { impl } = fetchWith("{}", { status });
		await assert.rejects(
			() =>
				omnigraphQuery({
					url: "https://graph.example",
					graph: "skills",
					query: "skill_catalog",
					token: "t",
					apiVersion: "0.14",
					timeoutMs: 1000,
					retries: 0,
					fetchImpl: impl,
				}),
			(error) => {
				assert.ok(error instanceof OmnigraphError);
				assert.equal(error.code, "denied");
				return true;
			},
		);
	}
	const { impl } = fetchWith("{}", { status: 500 });
	await assert.rejects(
		() =>
			omnigraphQuery({
				url: "https://graph.example",
				graph: "skills",
				query: "skill_catalog",
				token: "t",
				apiVersion: "0.14",
				timeoutMs: 1000,
				retries: 0,
				fetchImpl: impl,
			}),
		(error) => {
			assert.equal(error.code, "unavailable");
			return true;
		},
	);
});

test("a transient failure is read again, a bounded number of times", async () => {
	let calls = 0;
	const impl = async () => {
		calls += 1;
		if (calls < 3) throw new Error("the connection was reset");
		return new Response(
			queryAnswer({ columns: ["id"], rows: [["a"]] }),
			{ status: 200 },
		);
	};
	const result = await omnigraphQuery({
		url: "https://graph.example",
		graph: "skills",
		query: "skill_catalog",
		token: "t",
		apiVersion: "0.14",
		timeoutMs: 1000,
		fetchImpl: impl,
	});
	assert.equal(result.rows.length, 1);
	assert.equal(calls, 3);
});

test("an answer that is too large is refused", async () => {
	const big = queryAnswer({
		columns: ["id"],
		rows: [["x".repeat(200)]],
	});
	const { impl } = fetchWith(big);
	await assert.rejects(
		() =>
			omnigraphQuery({
				url: "https://graph.example",
				graph: "skills",
				query: "skill_catalog",
				token: "t",
				apiVersion: "0.14",
				timeoutMs: 1000,
				maxBytes: 10,
				fetchImpl: impl,
			}),
		(error) => {
			assert.equal(error.code, "invalid");
			return true;
		},
	);
});

test("an answer that lost rows is refused, not used", () => {
	assert.throws(
		() =>
			parseQueryResult(
				queryAnswer({ columns: ["id"], rows: [["a"]], row_count: 126 }),
			),
		(error) => {
			assert.equal(error.code, "invalid");
			return true;
		},
	);
});

test("a row is read as a list or as a record", () => {
	const answer = parseQueryResult(
		queryAnswer({
			columns: ["id", "name"],
			rows: [["a", "the first"]],
		}),
	);
	assert.equal(columnText(answer.rows[0], answer.columns, "name"), "the first");
	const objects = parseQueryResult(
		queryAnswer({
			columns: ["id", "name"],
			rows: [{ id: "b", name: "the second" }],
		}),
	);
	assert.equal(columnText(objects.rows[0], objects.columns, "name"), "the second");
});

// --- the source ------------------------------------------------------------

/** The answer of the catalog and of the lookup. */
function graphWith(skills) {
	return async (url, init) => {
		const body = JSON.parse(init.body);
		if (url.endsWith("skill_catalog")) {
			return new Response(
				queryAnswer({
					columns: ["id", "name", "description", "revision", "sha256"],
					rows: skills.map((skill) => [
						skill.id,
						skill.name,
						skill.description,
						skill.revision,
						skill.sha256 ?? "",
					]),
				}),
				{ status: 200 },
			);
		}
		const skill = skills.find((candidate) => candidate.id === body.params.id);
		if (!skill) {
			return new Response(queryAnswer({ columns: ["id"], rows: [] }), {
				status: 200,
			});
		}
		return new Response(
			queryAnswer({
				columns: [
					"id",
					"name",
					"description",
					"revision",
					"sha256",
					"repository",
					"path",
					"instructions",
					"resources_json",
				],
				rows: [
					[
						skill.id,
						skill.name,
						skill.description,
						skill.revision,
						skill.sha256 ?? "",
						"the-repository",
						"the/path",
						skill.instructions,
						skill.resourcesJson ?? "[]",
					],
				],
			}),
			{ status: 200 },
		);
	};
}

test("the catalog is discovery metadata, never instructions", async () => {
	const source = new OmnigraphSkillSource({
		config: CONFIG,
		fetchImpl: graphWith([
			{
				id: "the-skill",
				name: "the-skill",
				description: "a skill of the graph",
				revision: "abc123",
				instructions: "# The skill",
			},
		]),
	});
	const skills = await source.list();
	assert.equal(skills.length, 1);
	assert.equal(skills[0].id, "the-skill");
	assert.equal(skills[0].version, "abc123");
	assert.equal(skills[0].content, "");
	assert.equal(skills[0].contentComplete, false);
});

test("the search of the catalog finds a skill by its name and its id", async () => {
	const source = new OmnigraphSkillSource({
		config: CONFIG,
		fetchImpl: graphWith([
			{
				id: "frappe-dock",
				name: "override-grid-view",
				description: "the grid of a frappe site",
				revision: "abc",
				instructions: "# The skill",
			},
			{
				id: "other",
				name: "something else",
				description: "another skill",
				revision: "abc",
				instructions: "# Other",
			},
		]),
	});
	assert.equal((await source.list({ search: "grid" })).length, 1);
	assert.equal((await source.list({ search: "other" })).length, 1);
	assert.equal((await source.list({ search: "nothing" })).length, 0);
});

test("the body of a skill is only complete when the hash matches", async () => {
	const instructions = "# The skill\n\nThe body.";
	const source = new OmnigraphSkillSource({
		config: CONFIG,
		fetchImpl: graphWith([
			{
				id: "the-skill",
				name: "the-skill",
				description: "",
				revision: "abc",
				instructions,
				sha256: omnigraphInstructionsHash(instructions),
			},
		]),
	});
	const skill = await source.get("the-skill");
	assert.equal(skill?.contentComplete, true);
	assert.equal(skill?.content, instructions);
});

test("a body that does not match the hash of the publication is refused", async () => {
	const source = new OmnigraphSkillSource({
		config: CONFIG,
		fetchImpl: graphWith([
			{
				id: "the-skill",
				name: "the-skill",
				description: "",
				revision: "abc",
				instructions: "# A body that was changed",
				sha256: omnigraphInstructionsHash("# The published body"),
			},
		]),
	});
	await assert.rejects(
		() => source.get("the-skill"),
		(error) => {
			assert.ok(error instanceof OmnigraphError);
			assert.equal(error.code, "invalid");
			return true;
		},
	);
});

test("a record of a publication that is not approved is refused", async () => {
	const instructions = "# The skill";
	const source = new OmnigraphSkillSource({
		config: CONFIG,
		approvedRevision: "the-approved",
		fetchImpl: graphWith([
			{
				id: "the-skill",
				name: "the-skill",
				description: "",
				revision: "another-revision",
				instructions,
				sha256: omnigraphInstructionsHash(instructions),
			},
		]),
	});
	await assert.rejects(
		() => source.get("the-skill"),
		(error) => {
			assert.equal(error.code, "invalid");
			assert.match(error.message, /the-approved/);
			return true;
		},
	);
});

test("a skill that the graph does not hold is nothing", async () => {
	const source = new OmnigraphSkillSource({
		config: CONFIG,
		fetchImpl: graphWith([]),
	});
	assert.equal(await source.get("missing"), null);
	assert.equal(await source.record("missing"), null);
});
