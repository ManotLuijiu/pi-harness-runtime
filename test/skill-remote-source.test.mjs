/**
 * Tests for the skill service as a source of server-held skills.
 *
 * The service holds the authoritative skill files. It also applies the
 * access rules of the user, so a refusal is an ANSWER of the service and
 * not a failure of the client - the two need different fixes and must
 * stay apart.
 *
 * The gateway is injected, so the test never reaches the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { SkillServiceError, SkillServiceSource } from "../harness/skill-remote-source.ts";

/** A gateway that answers with the given skills. */
function gatewayWith(skills, options = {}) {
	return {
		async syncSkillsFromSaaS() {
			if (options.failure) {
				return {
					source: "none",
					skills: [],
					error: options.error ?? "the service refused the call",
					failure: options.failure,
				};
			}
			return { source: "saas", skills };
		},
		async getSkillFromSaaS(identifier) {
			if (options.failure) return null;
			return (
				skills.find((skill) => skill.id === identifier.id) ?? null
			);
		},
	};
}

test("the skills of the service are listed with their version", async () => {
	const source = new SkillServiceSource(
		gatewayWith([
			{
				id: "abc",
				name: "shared-skill",
				description: "the shared skill",
				version: "1.2.0",
				updatedAt: "2026-10-25T00:00:00Z",
			},
		]),
	);

	const skills = await source.list();

	assert.equal(skills.length, 1);
	assert.equal(skills[0].id, "abc");
	assert.equal(skills[0].version, "1.2.0");
	assert.equal(skills[0].updatedAt, "2026-10-25T00:00:00Z");
});

test("the search narrows the list of the service", async () => {
	const source = new SkillServiceSource(
		gatewayWith([
			{ id: "a", name: "frappe-field-order", description: "the field order" },
			{ id: "b", name: "other", description: "something else" },
		]),
	);

	const skills = await source.list({ search: "field-order" });

	assert.deepEqual(
		skills.map((skill) => skill.id),
		["a"],
	);
});

test("the limit keeps the list short", async () => {
	const source = new SkillServiceSource(
		gatewayWith([
			{ id: "a", name: "a", description: "a" },
			{ id: "b", name: "b", description: "b" },
			{ id: "c", name: "c", description: "c" },
		]),
	);

	const skills = await source.list({ limit: 2 });

	assert.equal(skills.length, 2);
});

test("the content of a skill is complete", async () => {
	const source = new SkillServiceSource(
		gatewayWith([
			{
				id: "abc",
				name: "shared-skill",
				description: "the shared skill",
				version: "1.2.0",
				prompt: "the complete body of the skill",
			},
		]),
	);

	const skill = await source.get("abc");

	assert.equal(skill?.content, "the complete body of the skill");
	// The service delivers the whole skill - unlike a vector store
	// payload, which carries a truncated body.
	assert.equal(skill?.contentComplete, true);
});

test("an unknown skill is null", async () => {
	const source = new SkillServiceSource(gatewayWith([]));

	assert.equal(await source.get("nope"), null);
});

test("a refused service is denied", async () => {
	const source = new SkillServiceSource(
		gatewayWith([], { failure: "denied", error: "unauthorized" }),
	);

	await assert.rejects(
		() => source.list(),
		(error) => {
			assert.ok(error instanceof SkillServiceError);
			// The refusal must be distinguishable from an unreachable
			// service: the user needs a different fix.
			assert.equal(error.code, "denied");
			assert.match(error.message, /unauthorized/);
			return true;
		},
	);
});

test("an unreachable service is unavailable", async () => {
	const source = new SkillServiceSource(
		gatewayWith([], { failure: "unavailable", error: "connection refused" }),
	);

	await assert.rejects(
		() => source.list(),
		(error) => {
			assert.ok(error instanceof SkillServiceError);
			assert.equal(error.code, "unavailable");
			return true;
		},
	);
});
