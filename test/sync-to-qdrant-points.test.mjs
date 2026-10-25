/**
 * Tests for the points that the sync script writes.
 *
 * The script and the runtime registry fill the same collection. They used
 * to disagree about the identity of a point: the runtime hashed the name
 * of the skill, the script used a running number. The same skill then
 * existed twice, and a running number could overwrite the point of an
 * unrelated skill.
 *
 * The script is a command line program - it runs when it is imported - so
 * the contract is checked on its source.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, "..", "scripts", "sync-to-qdrant.ts"), "utf8");

test("the script builds its points with the shared schema", () => {
	assert.match(
		script,
		/skillQdrantPoint\(\{/,
		"the script must build the point through the shared helper",
	);
	assert.match(
		script,
		/skillPointPayload\(\{/,
		"the script must build the payload through the shared helper",
	);
});

test("the script does not number the points", () => {
	assert.doesNotMatch(
		script,
		/id:\s*idx\s*\+/,
		"a running number leaves a second point for every skill the runtime indexes",
	);
});

test("the script writes into the versioned collection", () => {
	assert.match(
		script,
		/QDRANT_COLLECTION\s*\|\|\s*SKILL_COLLECTION/,
		"the default collection must be the versioned one",
	);
	assert.doesNotMatch(
		script,
		/QDRANT_COLLECTION\s*\|\|\s*LEGACY_SKILL_COLLECTION/,
		"the legacy collection holds vectors of another model",
	);
});
