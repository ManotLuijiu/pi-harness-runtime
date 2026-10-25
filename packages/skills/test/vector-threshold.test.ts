/**
 * The score that decides whether a hit of the vector store is a hit.
 *
 * The score of a vector search is a cosine between two vectors, and its
 * scale belongs to the model that produced them. The runtime embeds with
 * `text-embedding-3-small`, whose cosines for a query that names a skill
 * land between 0.31 and 0.56 - while a query about something else reaches
 * 0.23 at most.
 *
 * The threshold used to be 0.5, a value of the MiniLM collection, whose
 * vectors are not comparable. Against the runtime collection it threw away
 * every clear match (0.47) - a search of a filled collection returned
 * nothing at all, and the skill was invisible.
 *
 * The threshold therefore lives next to the model, and the tests below
 * hold it there.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	createSkillRegistry,
	type QdrantClientLike,
	type QdrantEmbedderLike,
} from "../src/loader.js";
import { SKILL_MIN_SCORE } from "../src/vector-schema.js";

/** A client that answers a query with the given points. */
function fakeClient(points: Array<{ id: number; score: number }>): QdrantClientLike {
	return {
		async upsert(): Promise<void> {},
		async query(): Promise<unknown> {
			return { points };
		},
		async getCollection(): Promise<unknown> {
			return { config: { params: { vectors: { size: 1536, distance: "Cosine" } } } };
		},
	};
}

/** An embedder that returns a fixed vector. */
const fakeEmbedder: QdrantEmbedderLike = {
	async createEmbedding() {
		return { embedding: [0.1, 0.2, 0.3], tokens: 3 };
	},
};

const registryWith = (scores: number[]) =>
	createSkillRegistry({
		qdrantClient: fakeClient(
			scores.map((score, index) => ({
				id: index + 1,
				score,
				payload: { name: `skill-${index}`, description: "d", body: "b" },
			})),
		),
		embedder: fakeEmbedder,
		collection: "pi-harness-skills-test",
	});

describe("the score that decides whether a hit is a hit", () => {
	it("belongs to the model of the collection", () => {
		// The measured values: a query that names a skill scores 0.31 to
		// 0.56, a query about something else 0.10 to 0.23.
		expect(SKILL_MIN_SCORE).toBeGreaterThan(0.23);
		expect(SKILL_MIN_SCORE).toBeLessThan(0.31);
	});

	it("keeps a clear match that the old threshold of 0.5 threw away", async () => {
		// 0.47 is a clear match of the runtime model - and below 0.5.
		const registry = registryWith([0.47]);

		const results = await registry.findVector("approve a purchase order");

		expect(results).toHaveLength(1);
		expect(results[0].score).toBe(0.47);
	});

	it("drops a hit that is noise", async () => {
		const registry = registryWith([0.23]);

		const results = await registry.findVector("cook a risotto");

		expect(results).toHaveLength(0);
	});

	it("keeps the hits above it and drops the hits below it", async () => {
		const registry = registryWith([0.55, 0.12, 0.4, 0.2]);

		const results = await registry.findVector("a query");

		expect(results.map((r) => r.score)).toEqual([0.55, 0.4]);
	});

	it("is the threshold of the skill command too", () => {
		// The command passed 0.5 itself, so the fix of the default would
		// not have reached the search of the user.
		const source = readFileSync(
			fileURLToPath(new URL("../src/skill-commands.ts", import.meta.url)),
			"utf8",
		);

		expect(source).toContain("SKILL_MIN_SCORE");
		expect(source).not.toMatch(/findVector\([^)]*,\s*5,\s*0\.5/);
	});
});
