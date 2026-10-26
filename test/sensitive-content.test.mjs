/**
 * The published files must not hold a client name.
 *
 * The other checks of the package look at the paths of the published
 * files: a private skill directory, a local state directory, a plugin
 * that is not shipped. None of them looks at what is INSIDE a published
 * file. A name in a comment, in a doc or in a string is published like
 * any other byte - and npm keeps a published version for a long time, so
 * the removal of one is a support ticket rather than a command.
 *
 * The verifier now scans the content of the published files with the same
 * list that the pull request check uses. Without a list it scans nothing,
 * and it says so: "no name was found" and "nothing was looked at" are not
 * the same statement.
 *
 * The term in this file is a placeholder. A real client name in a test of
 * the check that keeps client names out would be the exact mistake the
 * check exists to prevent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/**
 * The verifier packs the whole application and reads every published
 * file. That takes several seconds, and the runner's default per-test
 * timeout is five seconds - enough on a fast machine, not enough on a
 * slow one.
 */
const TEST_TIMEOUT_MS = 180_000;

/**
 * A term that really is in the published files.
 *
 * The name of the package is in its own manifest, so a list with it
 * makes the scan find a hit in a file that ships - without inventing a
 * name that would only live in this test.
 */
const A_TERM_THAT_SHIPS = "pi-harness-runtime";

/**
 * Run the verifier and return what it said.
 *
 * @param {string[]} terms the lines of the term list, empty for no list
 */
function verify(terms) {
	let dir = null;
	let listFile = null;
	const env = { ...process.env };
	delete env.SENSITIVE_TERMS;
	delete env.PI_SENSITIVE_TERMS_FILE;
	if (terms) {
		dir = mkdtempSync(join(tmpdir(), "sensitive-list-"));
		listFile = join(dir, "terms.txt");
		writeFileSync(listFile, `${terms.join("\n")}\n`, "utf8");
		env.PI_SENSITIVE_TERMS_FILE = listFile;
	}
	try {
		const result = spawnSync(
			"bun",
			[join(ROOT, "scripts", "verify-package-contents.ts"), "--pack"],
			{
				cwd: ROOT,
				encoding: "utf8",
				timeout: TEST_TIMEOUT_MS - 10_000,
				env,
			},
		);
		return {
			status: result.status,
			output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
		};
	} finally {
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
}

test("a published file that holds a term fails the verification", { timeout: TEST_TIMEOUT_MS }, () => {
	const result = verify([A_TERM_THAT_SHIPS]);
	assert.equal(result.status, 1, `the verifier failed:\n${result.output}`);
	assert.match(result.output, /\[sensitive-content\]/, "the problem is named");
	assert.match(result.output, /holds a term from the sensitive list/);
});

test("the report of the content scan never prints the term", { timeout: TEST_TIMEOUT_MS }, () => {
	const result = verify([A_TERM_THAT_SHIPS]);
	// The report names the file and the line. The term itself must not
	// be in it - the log of a release run is public.
	const problem = result.output
		.split("\n")
		.find((line) => line.includes("[sensitive-content]"));
	assert.ok(problem, "the problem is in the output");
	assert.equal(
		problem.includes(A_TERM_THAT_SHIPS),
		false,
		`the term is printed in the problem:\n${problem}`,
	);
});

test("without a list the verification says that it scanned nothing", { timeout: TEST_TIMEOUT_MS }, () => {
	const result = verify(null);
	assert.equal(result.status, 0, `the verifier failed:\n${result.output}`);
	assert.match(
		result.output,
		/the sensitive content scan was skipped: no term list is configured/,
		"the run says that nothing was looked at",
	);
});

test("with a list the verification looks at the published files", { timeout: TEST_TIMEOUT_MS }, () => {
	// A term that is in no published file: the run is clean, and it
	// says that it looked.
	const result = verify(["a-placeholder-that-is-in-no-file"]);
	assert.equal(result.status, 0, `the verifier failed:\n${result.output}`);
	assert.match(
		result.output,
		/the sensitive content scan looked at \d+ published file\(s\)/,
		"the run says that it looked",
	);
});
