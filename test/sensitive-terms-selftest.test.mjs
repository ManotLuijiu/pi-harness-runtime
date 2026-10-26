/**
 * The self test of the guard.
 *
 * The guard is only worth something when it really fails. A scanner that
 * reports "no term found" for a file that holds a term is worse than no
 * scanner, because it is trusted. The script
 * `scripts/sensitive-terms-selftest.sh` puts a synthetic term in front
 * of the scanner and checks that the scanner fails, that it fails closed
 * when there is no list, and that it never prints the term.
 *
 * The term is built while the script runs. A term that is written in the
 * repository would be found by the guard that scans the repository, so
 * the literal string must not be in the tree. The test builds the term
 * the same way, so it can look for it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** The test term, built the way the script builds it. */
const TERM = ["zz", "placeholder", "name"].join("");

/** The files that must not hold the term. */
const FILES = [
	join("scripts", "sensitive-terms-selftest.sh"),
	join(".github", "workflows", "sensitive-terms-selftest.yml"),
];

test("the self test proves the failing path of the guard", () => {
	const script = join(ROOT, "scripts", "sensitive-terms-selftest.sh");
	const stdout = execFileSync("bash", [script], {
		encoding: "utf8",
		timeout: 60000,
	});
	assert.match(stdout, /the failing path of the guard is proven/);
	// The report of a finding names the place and nothing else, and the
	// self test proves that as well.
	assert.equal(stdout.includes(TERM), false, "the term is not printed");
});

test("the term of the self test is not in the repository", () => {
	for (const file of FILES) {
		const content = readFileSync(join(ROOT, file), "utf8");
		assert.equal(
			content.includes(TERM),
			false,
			`${file} must not hold the term, or the guard would find the repository itself`,
		);
	}
});

test("the self test workflow holds no secret", () => {
	const workflow = readFileSync(
		join(ROOT, ".github", "workflows", "sensitive-terms-selftest.yml"),
		"utf8",
	);
	// The self test needs no list: it builds its own term. A workflow
	// that holds the list is a workflow that can leak it.
	assert.equal(/secrets\./.test(workflow), false);
	assert.equal(/SENSITIVE_TERMS/.test(workflow), false);
});

test("the self test workflow runs on a push and on demand", () => {
	const workflow = readFileSync(
		join(ROOT, ".github", "workflows", "sensitive-terms-selftest.yml"),
		"utf8",
	);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /push:\n {4}branches: \[develop, main\]/);
	// The self test reads the checkout and nothing else.
	assert.match(workflow, /permissions:\n {2}contents: read/);
	assert.equal(/write/.test(workflow), false);
});
