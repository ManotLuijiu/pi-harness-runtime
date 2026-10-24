/**
 * Regression tests for the vector indexing of the skill registry.
 *
 * The registry used to start one embedding request per registered skill, all
 * at the same time. A registry with a few hundred skills opened a few hundred
 * connections at once, which starved every other request of the process.
 *
 * These tests use an injected indexer, so they neither reach the network nor
 * touch a process-global module.
 */

import { describe, expect, test } from "bun:test";

import {
	createSkillRegistry,
	type SkillVectorIndexer,
	type SkillVectorPoint,
} from "../src/loader.js";
import type { Skill } from "../src/types.js";

/** An indexer that counts the requests it receives. */
class CountingIndexer implements SkillVectorIndexer {
	/** The number of texts of every embed call. */
	readonly embedCalls: string[][] = [];
	/** The points of every upsert call. */
	readonly upsertCalls: SkillVectorPoint[][] = [];
	/** The number of embed calls that were in flight at the same time. */
	maxConcurrentEmbeds = 0;
	private inFlight = 0;
	/** When set, every embed call waits for this gate. */
	gate: { promise: Promise<void>; release: () => void } | null = null;

	async embed(texts: string[]): Promise<number[][]> {
		this.inFlight += 1;
		this.maxConcurrentEmbeds = Math.max(this.maxConcurrentEmbeds, this.inFlight);
		this.embedCalls.push(texts);
		try {
			if (this.gate) await this.gate.promise;
			return texts.map((text) => [text.length, 1, 2]);
		} finally {
			this.inFlight -= 1;
		}
	}

	async upsert(points: SkillVectorPoint[]): Promise<void> {
		this.upsertCalls.push(points);
	}

	/** The number of texts that were embedded. */
	get embeddedCount(): number {
		return this.embedCalls.reduce((total, texts) => total + texts.length, 0);
	}
}

/** A skill with the given id and body. */
function makeSkill(id: string, body = `body of ${id}`): Skill {
	return {
		id,
		path: `/tmp/skills/${id}`,
		frontmatter: {
			name: id,
			description: `description of ${id}`,
			version: "1.0.0",
		},
		body,
		references: [],
		examples: [],
		metadata: {},
		loaded: false,
	};
}

/** Wait until the registry has no queued skill left. */
async function settle(registry: { isIndexing(): boolean }): Promise<void> {
	for (let attempt = 0; attempt < 200 && registry.isIndexing(); attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe("skill vector indexing", () => {
	test("one embedding request carries many skills", async () => {
		const indexer = new CountingIndexer();
		const registry = createSkillRegistry({ indexer });

		for (let i = 0; i < 100; i++) {
			registry.register(makeSkill(`skill-${i}`));
		}
		await settle(registry);

		expect(indexer.embeddedCount).toBe(100);
		expect(indexer.embedCalls.length).toBeLessThanOrEqual(4);
		expect(indexer.maxConcurrentEmbeds).toBe(1);
		expect(indexer.upsertCalls.length).toBe(indexer.embedCalls.length);
	});

	test("the number of requests does not grow with the number of skills", async () => {
		const small = new CountingIndexer();
		const smallRegistry = createSkillRegistry({ indexer: small, batchSize: 8 });
		for (let i = 0; i < 8; i++) smallRegistry.register(makeSkill(`small-${i}`));
		await settle(smallRegistry);

		const large = new CountingIndexer();
		const largeRegistry = createSkillRegistry({ indexer: large, batchSize: 8 });
		for (let i = 0; i < 80; i++) largeRegistry.register(makeSkill(`large-${i}`));
		await settle(largeRegistry);

		// Ten times the skills, ten times the requests - never ten times the
		// skills in a single request.
		expect(large.embedCalls.length).toBe(10);
		expect(large.embedCalls.length).toBe(small.embedCalls.length * 10);
	});

	test("only one embedding request is in flight at a time", async () => {
		const indexer = new CountingIndexer();
		const registry = createSkillRegistry({ indexer, batchSize: 4 });

		let release!: () => void;
		indexer.gate = {
			promise: new Promise<void>((resolve) => {
				release = resolve;
			}),
			release: () => {},
		};

		for (let i = 0; i < 40; i++) {
			registry.register(makeSkill(`gated-${i}`));
		}
		await new Promise((resolve) => setTimeout(resolve, 50));

		// The queue waits for the first batch, so no second request started.
		expect(indexer.embedCalls.length).toBe(1);

		indexer.gate.release = release;
		indexer.gate = null;
		release();
		await settle(registry);

		expect(indexer.embeddedCount).toBe(40);
		expect(indexer.maxConcurrentEmbeds).toBe(1);
	});

	test("a skill whose text did not change is not indexed again", async () => {
		const indexer = new CountingIndexer();
		const registry = createSkillRegistry({ indexer });

		registry.register(makeSkill("stable"));
		await settle(registry);
		expect(indexer.embeddedCount).toBe(1);

		// The same skill, registered again with the same text.
		registry.register(makeSkill("stable"));
		await settle(registry);
		expect(indexer.embeddedCount).toBe(1);

		// The same skill with a different body is indexed again.
		registry.register(makeSkill("stable", "a different body"));
		await settle(registry);
		expect(indexer.embeddedCount).toBe(2);
	});

	test("the points carry the vector of their skill", async () => {
		const indexer = new CountingIndexer();
		const registry = createSkillRegistry({ indexer, batchSize: 2 });

		registry.register(makeSkill("alpha"));
		registry.register(makeSkill("beta"));
		await settle(registry);

		const points = indexer.upsertCalls.flat();
		expect(points.length).toBe(2);
		expect(points.map((point) => point.payload.name).sort()).toEqual(["alpha", "beta"]);
		for (const point of points) {
			expect(point.vector.length).toBe(3);
		}
	});

	test("a registry without an index keeps no vectors", async () => {
		const registry = createSkillRegistry({ indexer: null });

		registry.register(makeSkill("unindexed"));
		await settle(registry);

		expect(registry.list().length).toBe(1);
		expect(registry.isQdrantFailed()).toBe(false);
	});

	test("a failing index does not stop the other skills", async () => {
		let calls = 0;
		const indexer: SkillVectorIndexer = {
			embed: async (texts: string[]) => {
				calls += 1;
				if (calls === 1) throw new Error("the index is unavailable");
				return texts.map(() => [1, 2, 3]);
			},
			upsert: async () => {},
		};
		const registry = createSkillRegistry({ indexer, batchSize: 2 });

		registry.register(makeSkill("first"));
		registry.register(makeSkill("second"));
		await settle(registry);

		expect(registry.list().length).toBe(2);
	});
});
