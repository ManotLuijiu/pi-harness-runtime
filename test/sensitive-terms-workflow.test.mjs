/**
 * The sensitive term workflow holds a secret, so its shape is a safety
 * property and not a matter of taste.
 *
 * `pull_request_target` is the trigger that makes the repository secret
 * available to a pull request from a fork. It is also the trigger that
 * runs a workflow in the context of the base branch while the pull
 * request is untrusted code. The two facts sit next to each other, so
 * the invariants below are the ones that keep the second one harmless:
 *
 *   - the head of the pull request is never checked out,
 *   - nothing of the pull request is built, installed or executed,
 *   - the credential of the checkout is not persisted,
 *   - the secret reaches one step and is never printed.
 *
 * The workflow is parsed as text. A YAML parser is not a dependency of
 * this package, and the invariants that matter here are about which
 * strings appear and how the file is shaped.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const workflow = readFileSync(
	join(ROOT, ".github", "workflows", "sensitive-terms.yml"),
	"utf8",
);

test("the workflow runs on pull_request_target, so a fork gets the secret", () => {
	assert.match(workflow, /pull_request_target:/);
	// A plain pull_request workflow gets no secret for a fork, and a
	// fork is where a pull request usually comes from.
	assert.equal(/^\s{2}pull_request:/m.test(workflow), false);
});

test("the workflow runs again when the pull request changes", () => {
	assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/);
});

test("the head of the pull request is never checked out", () => {
	// The head is untrusted code. A job that holds a secret must not
	// run it.
	assert.equal(workflow.includes("pull_request.head.sha"), false);
	assert.equal(workflow.includes("pull_request.head.ref"), false);
	assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
});

test("the checkout does not keep a credential", () => {
	assert.match(workflow, /persist-credentials: false/);
});

test("the workflow installs nothing and builds nothing", () => {
	for (const forbidden of [
		"bun install",
		"npm install",
		"npm ci",
		"npm run build",
		"bun run build",
		"tsc ",
	]) {
		assert.equal(
			workflow.includes(forbidden),
			false,
			`the workflow must not run "${forbidden}" in a job that holds a secret`,
		);
	}
});

test("the secret reaches the scan step and nothing else", () => {
	const steps = workflow.split(/\n {6}- name: /).slice(1);
	assert.ok(steps.length >= 2, "the workflow has a checkout and a scan step");
	const withSecret = steps.filter((step) => step.includes("secrets.SENSITIVE_TERMS"));
	assert.equal(withSecret.length, 1, "exactly one step reads the terms");
	assert.match(withSecret[0], /check-sensitive-terms\.mjs/);
});

test("the workflow never prints the terms", () => {
	// The log of a workflow run is public. A term that reaches it is
	// published a second time.
	assert.equal(/echo[^"'\n]*SENSITIVE_TERMS/.test(workflow), false);
	// The value is read exactly once, by the scan step.
	assert.equal((workflow.match(/secrets\.SENSITIVE_TERMS/g) ?? []).length, 1);
	// And it is bound to the environment of that step, nowhere else.
	assert.equal((workflow.match(/^\s+SENSITIVE_TERMS: /gm) ?? []).length, 1);
});

test("the workflow asks for no more than it reads", () => {
	assert.match(workflow, /permissions:\n {2}contents: read\n {2}pull-requests: read/);
	assert.equal(/write/.test(workflow), false);
});

test("the scan step runs the script of the checked out base branch", () => {
	// The script is the one of the base branch, so a pull request
	// cannot change the check that judges it.
	assert.match(workflow, /node scripts\/check-sensitive-terms\.mjs --pr "\$PR_NUMBER"/);
});
