/**
 * The initialization of the skills system.
 *
 * The test used to be a script that ran `initSkills()` while the module was
 * imported. That scanned the real skill directories of the machine and
 * started the vector indexing of every skill it found, which opened a
 * connection per skill and starved every other test of the process.
 *
 * The test now uses a temporary directory and a registry without a vector
 * index, so it neither reads the machine nor reaches the network.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initSkills } from "../src/index.js";
import { createSkillRegistry } from "../src/loader.js";

let tempDir: string;

/** Write a skill into a directory of the temporary home. */
function writeSkill(directory: string, name: string): void {
	const skillDir = join(tempDir, directory, name);
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, "SKILL.md"),
		[
			"---",
			`name: ${name}`,
			`description: The ${name} skill.`,
			"version: 1.0.0",
			"---",
			"",
			`The body of the ${name} skill.`,
			"",
		].join("\n"),
		"utf8",
	);
}

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "test-init-skills-"));
	mkdirSync(join(tempDir, "skills"), { recursive: true });
	writeSkill("skills", "alpha");
	writeSkill("skills", "beta");
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("the initialization of the skills system", () => {
	it("scans the given locations", () => {
		const result = initSkills({
			locations: [join(tempDir, "skills")],
			registry: createSkillRegistry({ indexer: null }),
		});

		expect(result.skills.length).toBe(2);
		expect(result.skills.map((skill) => skill.id).sort()).toEqual(["alpha", "beta"]);
		expect(result.errors).toEqual([]);
	});

	it("falls back to the default locations when none are given", () => {
		// The default locations point at the machine of the test, so the
		// result is only checked for its shape.
		const result = initSkills({
			registry: createSkillRegistry({ indexer: null }),
		});

		expect(Array.isArray(result.skills)).toBe(true);
		expect(Array.isArray(result.errors)).toBe(true);
	});

	it("falls back to the default locations when they are undefined", () => {
		// The bug case: an undefined value must not override the defaults.
		const result = initSkills({
			locations: undefined,
			registry: createSkillRegistry({ indexer: null }),
		});

		expect(Array.isArray(result.skills)).toBe(true);
		expect(Array.isArray(result.errors)).toBe(true);
	});

	it("accepts a partial configuration", () => {
		const result = initSkills({
			maxDepth: 5,
			includeHidden: true,
			registry: createSkillRegistry({ indexer: null }),
		});

		expect(Array.isArray(result.skills)).toBe(true);
	});

	it("accepts an empty list of locations", () => {
		const result = initSkills({
			locations: [],
			registry: createSkillRegistry({ indexer: null }),
		});

		expect(result.skills).toEqual([]);
	});

	it("registers the scanned skills in the registry", () => {
		const registry = createSkillRegistry({ indexer: null });

		initSkills({ locations: [join(tempDir, "skills")], registry });

		expect(registry.list().length).toBe(2);
	});
});
