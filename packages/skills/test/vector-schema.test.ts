/**
 * Regression tests for the point identity of the skill collection.
 *
 * Two writers fill the same collection: the runtime registry and
 * `scripts/sync-to-qdrant.ts`. They used to disagree about the identity of
 * a point - the runtime hashed the name of the skill, the script used a
 * running number. The same skill then existed twice, and a running number
 * could overwrite a point of an unrelated skill.
 *
 * The identity now comes from one shared place, and these tests hold it
 * there.
 */

import { describe, expect, test } from "bun:test";

import {
	createSkillRegistry,
	type SkillVectorIndexer,
	type SkillVectorPoint,
} from "../src/loader.js";
import {
	SKILL_PAYLOAD_BODY_LIMIT,
	SKILL_PAYLOAD_TEXT_LIMIT,
	skillPointPayload,
	skillQdrantPoint,
	stableHash,
} from "../src/vector-schema.js";
import type { Skill } from "../src/types.js";

/** Wait until the registry has no index work left. */
async function settle(registry: { isIndexing(): boolean }): Promise<void> {
	for (let attempt = 0; attempt < 200 && registry.isIndexing(); attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/** A skill with the given id and body. */
function makeSkill(id: string, body = `body of ${id}`): Skill {
	return {
		id,
		path: `/tmp/skills/${id}`,
		frontmatter: {
			name: id,
			description: `the ${id} skill`,
		},
		body,
		metadata: {} as Skill["metadata"],
	} as Skill;
}

/** An indexer that keeps the points it receives. */
class RecordingIndexer implements SkillVectorIndexer {
	readonly upsertCalls: SkillVectorPoint[][] = [];

	async embed(texts: string[]): Promise<number[][]> {
		return texts.map((text) => [text.length, 1, 2]);
	}

	async upsert(points: SkillVectorPoint[]): Promise<void> {
		this.upsertCalls.push(points);
	}
}

describe("the identity of a skill point", () => {
	test("the id of the point is the hash of the name in the payload", () => {
		const payload = skillPointPayload({
			name: "a-skill",
			description: "does something",
			body: "the body",
		});
		const point = skillQdrantPoint(payload);

		expect(point.id).toBe(stableHash(payload.name));
	});

	test("the same name always addresses the same point", () => {
		const first = skillQdrantPoint(
			skillPointPayload({ name: "a-skill", description: "one", body: "one" }),
		);
		const second = skillQdrantPoint(
			skillPointPayload({ name: "a-skill", description: "two", body: "two" }),
		);

		// The content may change, the identity of the point may not.
		expect(second.id).toBe(first.id);
	});

	test("different names address different points", () => {
		const first = skillQdrantPoint(
			skillPointPayload({ name: "a-skill", description: "d", body: "b" }),
		);
		const second = skillQdrantPoint(
			skillPointPayload({ name: "b-skill", description: "d", body: "b" }),
		);

		expect(second.id).not.toBe(first.id);
	});

	test("the payload carries the shared fields and nothing else", () => {
		const payload = skillPointPayload({
			name: "a-skill",
			title: "A Skill",
			description: "does something",
			body: "the body",
		});

		expect(Object.keys(payload).sort()).toEqual([
			"body",
			"description",
			"name",
			"text",
		]);
	});

	test("the payload and the text are truncated", () => {
		const payload = skillPointPayload({
			name: "a-skill",
			description: "d",
			body: "x".repeat(SKILL_PAYLOAD_BODY_LIMIT + 500),
		});

		expect(payload.body.length).toBe(SKILL_PAYLOAD_BODY_LIMIT);
		expect(payload.text.length).toBeLessThanOrEqual(
			SKILL_PAYLOAD_TEXT_LIMIT + payload.name.length + payload.description.length + 10,
		);
	});

	test("the title is part of the text when it differs from the name", () => {
		const withTitle = skillPointPayload({
			name: "a-skill",
			title: "A Human Title",
			description: "d",
			body: "b",
		});
		const withoutTitle = skillPointPayload({
			name: "a-skill",
			description: "d",
			body: "b",
		});

		expect(withTitle.text).toContain("A Human Title");
		expect(withoutTitle.text).not.toContain("A Human Title");
	});
});

describe("the runtime writes the points of the shared schema", () => {
	test("the indexed point carries the shared payload and id", async () => {
		const indexer = new RecordingIndexer();
		const registry = createSkillRegistry({ indexer });

		registry.register(makeSkill("alpha"));
		await settle(registry);

		const points = indexer.upsertCalls.flat();
		expect(points.length).toBe(1);

		const point = points[0];
		expect(point.id).toBe(stableHash(point.payload.name));
		expect(point.payload.name).toBe("alpha");
		expect(Object.keys(point.payload).sort()).toEqual([
			"body",
			"description",
			"name",
			"text",
		]);
	});
});
