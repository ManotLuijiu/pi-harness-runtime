/**
 * The names of the stubs of the graph.
 *
 * Two skills of the graph may carry the same name. The reader of pi
 * knows the skills by their name, so every skill gets a name of its own.
 *
 * The regression of a hang lives here: when the base of the name is
 * already 64 characters long, the suffix of the second name used to be
 * cut away, and the loop that looked for a free name never ended. The
 * loop is synchronous, so it blocked the start of pi, and only a
 * process that is killed from the outside can end it: the regression
 * runs the allocation in a subprocess with a timeout of its own.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stubRoot, writeStubs } from "../harness/omnigraph/cache.ts";

/** The directory of the test. */
const ROOT = join(import.meta.dirname, "..");

/** The script that allocates the names in a process of its own. */
const FIXTURE = join(import.meta.dirname, "fixtures", "omnigraph-name-collisions.mjs");

/** The longest name the reader of pi reads. */
const MAX_NAME = 64;

/** A name of 64 characters, the length that broke the allocation. */
const LONG_NAME = "a".repeat(64);

/** A catalog with colliding names. */
function entriesOf(count) {
	return Array.from({ length: count }, (_, index) => ({
		id: `the-skill-${index}`,
		name: LONG_NAME,
		description: `the skill ${index}`,
		revision: "abc123",
		sha256: "a".repeat(64),
	}));
}

/**
 * The names that the cache wrote for the stubs.
 */
function writtenNames(cacheDir) {
	const root = stubRoot(cacheDir);
	return readdirSync(root).map((id) => {
		const markdown = readFileSync(join(root, id, "SKILL.md"), "utf8");
		return /^name:\s*"(.*)"$/m.exec(markdown)?.[1] ?? "";
	});
}

/**
 * Run the allocation in a process of its own, with a timeout of its
 * own: a synchronous loop cannot be interrupted from the inside.
 */
function allocateInSubprocess(argument) {
	const args = argument === undefined ? [FIXTURE] : [FIXTURE, argument];
	return spawnSync(process.execPath, args, {
		cwd: ROOT,
		encoding: "utf8",
		timeout: 10_000,
	});
}

test("the allocation of the names does not block the start", () => {
	const run = allocateInSubprocess();
	assert.equal(
		run.error?.code,
		undefined,
		`the allocation did not end: ${run.error?.message}`,
	);
	assert.equal(run.status, 0, `the allocation failed: ${run.stderr}`);
});

test("the allocation of the names does not block the start without advertising", () => {
	const run = allocateInSubprocess("0");
	assert.equal(
		run.error?.code,
		undefined,
		`the allocation did not end: ${run.error?.message}`,
	);
	assert.equal(run.status, 0, `the allocation failed: ${run.stderr}`);
});

test("every skill of a colliding catalog gets a name of its own", () => {
	const dir = mkdtempSync(join(tmpdir(), "omnigraph-names-"));
	try {
		const entries = entriesOf(3);
		writeStubs(dir, entries);
		const names = writtenNames(dir);
		assert.equal(names.length, 3);
		assert.equal(
			new Set(names).size,
			3,
			`the names collide: ${names.join(", ")}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the names of a colliding catalog are names that pi reads", () => {
	const dir = mkdtempSync(join(tmpdir(), "omnigraph-names-"));
	try {
		writeStubs(dir, entriesOf(3));
		for (const name of writtenNames(dir)) {
			assert.ok(name.length > 0, "a skill has no name");
			assert.ok(
				name.length <= MAX_NAME,
				`the name "${name}" holds ${name.length} characters`,
			);
			assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `the name "${name}" is not a name of pi`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the names of a catalog that shares a prefix do not collide", () => {
	const dir = mkdtempSync(join(tmpdir(), "omnigraph-names-"));
	try {
		const entries = [
			{ ...entriesOf(1)[0], id: "one", name: `${LONG_NAME}-and-more` },
			{ ...entriesOf(1)[0], id: "two", name: `${LONG_NAME}-and-more-again` },
			{ ...entriesOf(1)[0], id: "three", name: LONG_NAME },
		];
		writeStubs(dir, entries);
		const names = writtenNames(dir);
		assert.equal(new Set(names).size, 3, `the names collide: ${names.join(", ")}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the names of a catalog are stable for a stable catalog", () => {
	const first = mkdtempSync(join(tmpdir(), "omnigraph-names-"));
	const second = mkdtempSync(join(tmpdir(), "omnigraph-names-"));
	try {
		const entries = entriesOf(3);
		writeStubs(first, entries);
		writeStubs(second, entries);
		assert.deepEqual(writtenNames(first), writtenNames(second));
	} finally {
		rmSync(first, { recursive: true, force: true });
		rmSync(second, { recursive: true, force: true });
	}
});
