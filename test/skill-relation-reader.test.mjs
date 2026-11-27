/**
 * The reader of the relationships of the graph.
 *
 * The tests prove the mapping of the rows to the edges, the bounds of the
 * reader and the refusal of a broken row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	createRelationReader,
	edgesOf,
	RELATION_QUERY,
} from "../harness/skill-relation-reader.ts";

/** An answer of the graph. */
function answer(rows, columns = [
	"from",
	"to",
	"type",
	"provenance",
	"revision",
	"owner",
	"applicable_versions",
	"symmetric",
]) {
	return { columns, rows, rowCount: rows.length };
}

test("a row becomes an edge with its provenance and its revision", () => {
	const edges = edgesOf(
		answer([
			[
				"skill-a",
				"skill-b",
				"requires",
				"published",
				"pub-1",
				"the team",
				"1.x",
				"false",
			],
		]),
		10,
	);
	assert.equal(edges.length, 1);
	assert.equal(edges[0].from, "skill-a");
	assert.equal(edges[0].to, "skill-b");
	assert.equal(edges[0].type, "requires");
	assert.equal(edges[0].provenance, "published");
	assert.equal(edges[0].revision, "pub-1");
	assert.equal(edges[0].owner, "the team");
	assert.equal(edges[0].applicableVersions, "1.x");
});

test("a row without a known type, provenance or revision is not an edge", () => {
	const edges = edgesOf(
		answer([
			["skill-a", "skill-b", "invented", "published", "pub-1"],
			["skill-a", "skill-b", "requires", "invented", "pub-1"],
			["skill-a", "skill-b", "requires", "published", ""],
			["skill-a", "", "requires", "published", "pub-1"],
		]),
		10,
	);
	assert.equal(edges.length, 0);
});

test("the reader respects the limit of the neighbours", () => {
	const rows = Array.from({ length: 5 }, (_, index) => [
		"skill-a",
		`skill-${index}`,
		"related_to",
		"reviewed",
		"pub-1",
	]);
	const edges = edgesOf(answer(rows), 2);
	assert.equal(edges.length, 2);
});

test("the reader asks the stored query of the relations with the bounds", async () => {
	const calls = [];
	const reader = createRelationReader({
		url: "https://graph.example",
		graph: "skills",
		token: "a-token",
		apiVersion: "0.14",
		timeoutMs: 1000,
		fetchImpl: async (url, init) => {
			calls.push({ url: String(url), body: init?.body });
			return new Response(
				JSON.stringify(
					answer([
						["skill-a", "skill-b", "requires", "published", "pub-1"],
					]),
				),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	});
	const edges = await reader.neighbors("skill-a", {
		types: ["requires"],
		limit: 5,
	});
	assert.equal(edges.length, 1);
	assert.equal(edges[0].to, "skill-b");
	assert.equal(calls.length, 1);
	assert.ok(String(calls[0].url).includes(`/graphs/skills/queries/${RELATION_QUERY}`));
	const body = JSON.parse(String(calls[0].body));
	assert.equal(body.params.skill, "skill-a");
	assert.deepEqual(body.params.types, ["requires"]);
	assert.equal(body.params.limit, 5);
});

test("a graph without the stored query refuses the read by name", async () => {
	const reader = createRelationReader({
		url: "https://graph.example",
		graph: "skills",
		token: "a-token",
		apiVersion: "0.14",
		timeoutMs: 1000,
		fetchImpl: async () =>
			new Response(JSON.stringify({ error: "unknown query" }), {
				status: 404,
				headers: { "content-type": "application/json" },
			}),
	});
	await assert.rejects(
		() => reader.neighbors("skill-a", { types: ["requires"], limit: 5 }),
		/skill_relations|unknown query|refused/i,
	);
});
