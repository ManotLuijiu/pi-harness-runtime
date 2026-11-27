/**
 * The reader of the vector index of the skills.
 *
 * The tests are an isolated E2E: a real HTTP server that speaks the search
 * route of Qdrant, and the real adapter against it. Nothing of the adapter
 * is replaced by a fake - only the cluster is a server of the test.
 *
 * What the tests prove:
 *
 * - the reader asks the cluster for the hits of a query and hands them out
 *   as the hits of the retrieval (the canonical identity, the score, the
 *   revision and the hash),
 * - a hit that does not carry the contract of the index is dropped,
 * - the reader never writes: the cluster only ever sees a search,
 * - the configuration of the reader has its own seam (the environment and
 *   the key files), and a machine without a cluster has no reader,
 * - the startup of the graph hands the search of the adapter to the
 *   registration, and the retrieval uses the hits of the index.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
	QdrantSkillIndex,
	readVectorIndexConfig,
} from "../harness/skill-vector-index.ts";
import { cacheNamespace } from "../harness/omnigraph/config.ts";
import { initOmnigraphSkills } from "../harness/omnigraph/startup.ts";

const NAMESPACE = "ns-of-the-scope";
const GRAPH = "skills";
const COLLECTION = "skills-afq";

/** The hash of a publication: 64 hex characters, as the catalog holds them. */
const HASH = "a".repeat(64);

/**
 * A cluster of the test.
 *
 * The server answers the search route of Qdrant and records every request,
 * so the tests can prove that the reader only ever reads.
 */
async function withCluster(handler, run) {
	const requests = [];
	const server = createServer((request, response) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			const body = chunks.join("utf8");
			requests.push({ method: request.method, url: request.url, body });
			handler(request, response, body);
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const url = `http://127.0.0.1:${address.port}`;
	try {
		return await run({ url, requests });
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

/** The answer of a search with the given points. */
function searchAnswer(points) {
	return JSON.stringify({ result: points });
}

/** A point of the index, with the payload of the generation. */
function point(overrides = {}) {
	return {
		id: 1,
		score: 0.83,
		payload: {
			identity: "the-index-skill",
			namespace: NAMESPACE,
			graph: GRAPH,
			id: "the-index-skill",
			name: "the-index-skill",
			description: "a skill of the graph",
			tags: "",
			revision: "rev-2",
			sha256: HASH,
		},
		...overrides,
	};
}

/** The reader of the test. */
function readerFor(url, overrides = {}) {
	return new QdrantSkillIndex({
		config: {
			url,
			collection: COLLECTION,
			namespace: NAMESPACE,
			graph: GRAPH,
			apiKey: "the-key-of-the-reader",
		},
		embed: async () => [0.1, 0.2, 0.3],
		...overrides,
	});
}

test("the reader hands out the hits of the index with their identity", async () => {
	await withCluster(
		(_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(searchAnswer([point()]));
		},
		async ({ url, requests }) => {
			const hits = await readerFor(url).search("deploy the graph", 5);
			assert.equal(hits.length, 1);
			assert.deepEqual(hits[0], {
				id: "the-index-skill",
				score: 0.83,
				revision: "rev-2",
				sha256: HASH,
			});

			// The cluster was asked for the search of the collection, with
			// the vector of the query and the payload of the points.
			assert.equal(requests.length, 1);
			assert.equal(requests[0].method, "POST");
			assert.equal(requests[0].url, `/collections/${COLLECTION}/points/search`);
			const body = JSON.parse(requests[0].body);
			assert.deepEqual(body.vector, [0.1, 0.2, 0.3]);
			assert.equal(body.limit, 5);
			assert.equal(body.with_payload, true);
			assert.equal(body.with_vector, false);
		},
	);
});

test("a hit without the contract of the index is dropped", async () => {
	await withCluster(
		(_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				searchAnswer([
					point(),
					// The old collection: a numeric id and a name only.
					{ id: 7, score: 0.9, payload: { name: "an-old-skill" } },
					// Another scope.
					point({
						payload: {
							...point().payload,
							identity: "a-skill-of-another-scope",
							namespace: "ns-of-another-scope",
						},
					}),
					// Another graph.
					point({
						payload: {
							...point().payload,
							identity: "a-skill-of-another-graph",
							graph: "another-graph",
						},
					}),
				]),
			);
		},
		async ({ url }) => {
			const dropped = [];
			const hits = await readerFor(url, { log: (message) => dropped.push(message) }).search(
				"deploy",
				5,
			);
			assert.equal(hits.length, 1);
			assert.equal(hits[0].id, "the-index-skill");
			assert.equal(dropped.length, 3);
		},
	);
});

test("the reader never writes to the cluster", async () => {
	await withCluster(
		(_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(searchAnswer([]));
		},
		async ({ url, requests }) => {
			await readerFor(url).search("deploy", 3);
			await readerFor(url).status();
			// The reader reads and never writes: the search is a POST on
			// the search route and the status is a GET on the collection.
			for (const request of requests) {
				assert.notEqual(request.method, "PUT");
				assert.notEqual(request.method, "PATCH");
				assert.notEqual(request.method, "DELETE");
				assert.ok(
					request.url.includes("/points/search") ||
						request.url === `/collections/${COLLECTION}`,
					`the reader asked for ${request.url}`,
				);
			}
		},
	);
});

test("the status of an index that cannot be read says so", async () => {
	await withCluster(
		(_request, response) => {
			response.writeHead(503);
			response.end("unavailable");
		},
		async ({ url }) => {
			const status = await readerFor(url).status();
			assert.equal(status.configured, true);
			assert.equal(status.available, false);
			assert.match(status.reason ?? "", /503/);
		},
	);
});

test("the configuration of the reader has its own seam", () => {
	// Without a cluster there is no reader.
	assert.equal(
		readVectorIndexConfig({
			env: {},
			readKey: () => undefined,
			namespace: NAMESPACE,
			graph: GRAPH,
		}),
		null,
	);

	// The environment wins over the key file.
	const config = readVectorIndexConfig({
		env: {
			QDRANT_CLUSTER_ENDPOINT: "https://cluster.example",
			QDRANT_CLUSTER_ENDPOINT_FILE: "",
			QDRANT_COLLECTION: COLLECTION,
		},
		readKey: (name) =>
			name === "QDRANT_CLUSTER_ENDPOINT" ? "https://file.example" : undefined,
		namespace: NAMESPACE,
		graph: GRAPH,
	});
	assert.equal(config?.url, "https://cluster.example");
	assert.equal(config?.collection, COLLECTION);
	assert.equal(config?.namespace, NAMESPACE);
	assert.equal(config?.graph, GRAPH);

	// The key file is the fallback.
	const fromFile = readVectorIndexConfig({
		env: {},
		readKey: (name) => {
			if (name === "QDRANT_CLUSTER_ENDPOINT") return "https://file.example";
			if (name === "QDRANT_COLLECTION") return COLLECTION;
			if (name === "QDRANT_API_KEY") return "the-key-of-the-reader";
			return undefined;
		},
		namespace: NAMESPACE,
		graph: GRAPH,
	});
	assert.equal(fromFile?.url, "https://file.example");
	assert.equal(fromFile?.apiKey, "the-key-of-the-reader");
});

test("the startup hands the search of the adapter to the registration", async () => {
	const catalog = JSON.stringify({
		columns: ["id", "name", "description", "revision", "sha256"],
		rows: [
			["the-index-skill", "the-index-skill", "a skill of the graph", "rev-2", HASH],
			["the-lexical-skill", "the-lexical-skill", "another skill", "rev-1", HASH],
		],
	});
	const token = "the-token-of-the-reader";
	const url = "https://graph.example";
	const namespace = cacheNamespace({ url, graph: GRAPH, token });

	const tools = [];
	const pi = {
		tools,
		on() {},
		registerTool(tool) {
			tools.push(tool);
		},
		registerCommand() {},
	};

	const previousStage = process.env.PI_SKILL_HYBRID_STAGE;
	process.env.PI_SKILL_HYBRID_STAGE = "pilot";
	try {
		const startup = initOmnigraphSkills(pi, {
			insert: () => {},
			log: () => {},
			saasConfigured: false,
			env: {
				HOME: "/home/tester",
				OMNIGRAPH_URL: url,
				OMNIGRAPH_GRAPH: GRAPH,
				OMNIGRAPH_SKILLS_TOKEN: token,
				OMNIGRAPH_CACHE_DIR: "/tmp/omnigraph-vector-index-test",
				QDRANT_CLUSTER_ENDPOINT: "https://cluster.example",
				QDRANT_COLLECTION: COLLECTION,
			},
			// The embedding of the test: the transport of the cluster is
			// the only thing that is replaced.
			embed: async () => [0.5, 0.5],
			fetchImpl: async (request) => {
				const target = typeof request === "string" ? request : request.url;
				if (target.startsWith("https://cluster.example")) {
					return new Response(
						searchAnswer([
							point({
								payload: { ...point().payload, namespace },
							}),
						]),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return new Response(catalog, { status: 200 });
			},
		});
		await startup.ready;

		const search = tools.find((tool) => tool.name === "remote_skill_search");
		assert.ok(search, "the search tool of the graph is registered");
		const result = await search.execute("call-1", {
			query: "zzz-a-token-that-matches-nothing",
			limit: 5,
		});
		const candidates = result.details.candidates ?? [];
		const fromTheIndex = candidates.find((entry) => entry.id === "the-index-skill");
		assert.ok(fromTheIndex, "the hit of the index became a candidate");
		assert.deepEqual(fromTheIndex.methods, ["vector"]);
	} finally {
		if (previousStage === undefined) delete process.env.PI_SKILL_HYBRID_STAGE;
		else process.env.PI_SKILL_HYBRID_STAGE = previousStage;
	}
});
