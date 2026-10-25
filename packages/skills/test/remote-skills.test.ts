/**
 * The skills that only exist in the vector store.
 *
 * The vector store holds the skills of a team. A client that has no local
 * copy of a skill must still be able to find it - and to use it: the
 * payload carries the name, the description and the body.
 *
 * The registry used to DROP every hit whose skill was not registered
 * locally, so a shared skill was invisible on every machine that had no
 * local copy of it - which is exactly the case the vector store exists for.
 *
 * The client and the embedder are injected, so the test neither reaches the
 * network nor replaces a process-global module.
 */

import { describe, expect, it } from "bun:test";

import {
	createSkillRegistry,
	type QdrantClientLike,
	type QdrantEmbedderLike,
} from "../src/loader.js";
import type { Skill } from "../src/types.js";

/** A point of the vector store. */
interface VectorPoint {
	id: number;
	score: number;
	payload?: Record<string, unknown>;
}

/** A client that answers a query with the given points. */
function fakeClient(
	points: VectorPoint[],
	description?: Record<string, unknown>,
): QdrantClientLike & { queries: number } {
	const client = {
		queries: 0,
		async upsert(): Promise<void> {},
		async query(): Promise<unknown> {
			client.queries += 1;
			return { points };
		},
		async getCollection(): Promise<unknown> {
			if (!description) throw new Error("Not found: Collection not found");
			return description;
		},
	};
	return client;
}

/** An embedder that returns a fixed vector. */
const fakeEmbedder: QdrantEmbedderLike = {
	async createEmbedding() {
		return { embedding: [0.1, 0.2, 0.3], tokens: 3 };
	},
};

/** A local skill, as the scanner would register it. */
function localSkill(id: string): Skill {
	return {
		id,
		path: `/tmp/skills/${id}`,
		frontmatter: { name: id, description: `the local ${id}` },
		body: `the local body of ${id}`,
		references: [],
		examples: [],
		metadata: { name: id, description: `the local ${id}` },
		loaded: false,
	};
}

describe("a skill that only exists in the vector store", () => {
	it("is found instead of being dropped", async () => {
		const client = fakeClient([
			{
				id: 19,
				score: 0.91,
				payload: {
					name: "frappe-doctype-field-order",
					description: "the shared skill",
					body: "the shared body",
				},
			},
		]);
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-test",
		});

		const results = await registry.findVector("field order");

		expect(results).toHaveLength(1);
		expect(results[0].source).toBe("remote");
		expect(results[0].skill.id).toBe("frappe-doctype-field-order");
		// The payload is the skill - the body travels with it.
		expect(results[0].skill.body).toBe("the shared body");
		expect(results[0].skill.frontmatter.description).toBe("the shared skill");
	});

	it("does not count as a local skill", async () => {
		const client = fakeClient([
			{ id: 19, score: 0.9, payload: { name: "shared", description: "d", body: "b" } },
		]);
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-test",
		});
		registry.register(localSkill("local-one"));

		await registry.findVector("shared");

		// The local count stays local - that is what the startup line shows.
		expect(registry.list()).toHaveLength(1);
		expect(registry.list().map((skill) => skill.id)).toEqual(["local-one"]);
		expect(registry.listRemote().map((skill) => skill.id)).toEqual(["shared"]);
	});

	it("can be loaded without a local directory", async () => {
		const client = fakeClient([
			{ id: 19, score: 0.9, payload: { name: "shared", description: "d", body: "the body" } },
		]);
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-test",
		});

		await registry.findVector("shared");
		const loaded = await registry.load("shared");

		expect(loaded).not.toBeNull();
		expect(loaded?.body).toBe("the body");
		expect(loaded?.path).toBe("");
	});

	it("marks a local hit as local", async () => {
		const client = fakeClient([
			{ id: 1, score: 0.9, payload: { name: "local-one", description: "d", body: "b" } },
		]);
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-test",
		});
		registry.register(localSkill("local-one"));

		const results = await registry.findVector("local");

		expect(results).toHaveLength(1);
		expect(results[0].source).toBe("local");
		expect(results[0].skill.path).toBe("/tmp/skills/local-one");
	});

	it("skips a hit without a name", async () => {
		const client = fakeClient([
			{ id: 1, score: 0.9, payload: { description: "no name" } },
			{ id: 2, score: 0.8, payload: { name: "", description: "empty name" } },
		]);
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-test",
		});

		expect(await registry.findVector("anything")).toHaveLength(0);
	});
});

describe("the state of the vector store", () => {
	it("reports the number of skills", async () => {
		const client = fakeClient([], {
			points_count: 79,
			config: { params: { vectors: { size: 1536, distance: "Cosine" } } },
		});
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-openai-v1",
		});

		const stats = await registry.getQdrantStats();

		expect(stats.state).toBe("populated");
		expect(stats.count).toBe(79);
		expect(stats.dimensions).toBe(1536);
		expect(stats.schemaMismatch).toBeUndefined();
	});

	it("names the real cause of an incompatible collection", async () => {
		const client = fakeClient([], {
			points_count: 79,
			config: { params: { vectors: { size: 384, distance: "Cosine" } } },
		});
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills",
		});

		const stats = await registry.getQdrantStats();

		// The mismatch names the numbers, so the reader knows WHICH schema
		// the collection was built with.
		expect(stats.schemaMismatch).toContain("384");
		expect(stats.schemaMismatch).toContain("1536");
		expect(stats.schemaMismatch).toContain("sync-to-qdrant.ts");
	});

	it("reports an empty collection", async () => {
		const client = fakeClient([], {
			points_count: 0,
			config: { params: { vectors: { size: 1536, distance: "Cosine" } } },
		});
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-openai-v1",
		});

		const stats = await registry.getQdrantStats();

		expect(stats.state).toBe("empty");
		expect(stats.count).toBe(0);
	});

	it("reports a collection that does not exist", async () => {
		const client = fakeClient([]);
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-openai-v1",
		});

		const stats = await registry.getQdrantStats();

		expect(stats.state).toBe("missing");
		expect(stats.count).toBe(0);
	});

	it("names the skills of the legacy collection", async () => {
		// The runtime collection does not exist yet, but the collection of
		// the previous version still holds the skills. They are not lost -
		// the reader has to know where they are.
		const client = {
			async upsert(): Promise<void> {},
			async query(): Promise<unknown> {
				return { points: [] };
			},
			async getCollection(name: string): Promise<unknown> {
				if (name === "pi-harness-skills") {
					return {
						points_count: 79,
						config: { params: { vectors: { size: 384, distance: "Cosine" } } },
					};
				}
				throw new Error("Not Found");
			},
		};
		const registry = createSkillRegistry({
			qdrantClient: client as never,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills-openai-v1",
		});

		const stats = await registry.getQdrantStats();

		expect(stats.state).toBe("missing");
		expect(stats.legacy?.collection).toBe("pi-harness-skills");
		expect(stats.legacy?.count).toBe(79);
		expect(stats.legacy?.dimensions).toBe(384);
		expect(stats.legacy?.model).toBe("sentence-transformers/all-MiniLM-L6-v2");
	});

	it("does not look for a second collection when the legacy one is the runtime one", async () => {
		const client = fakeClient([], {
			points_count: 0,
			config: { params: { vectors: { size: 1536, distance: "Cosine" } } },
		});
		const registry = createSkillRegistry({
			qdrantClient: client,
			embedder: fakeEmbedder,
			collection: "pi-harness-skills",
		});

		const stats = await registry.getQdrantStats();

		expect(stats.legacy).toBeUndefined();
	});
});
